import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { ConversationApplication, type Attachment, type AttachmentMetadata, type AttachmentResourcesPort, type AttachmentSourceId, type ConversationRuntimePort, type Delivery, type ExtensionResponse, type RuntimeSend } from '../../../src/modules/conversation/index';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const turns = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const MiB = 1024 * 1024;

/** Pure resource Fake: metadata admission precedes simulated byte reads, with controllable await points. */
class FakeResources implements AttachmentResourcesPort {
  sequence = 0;
  available = new Set(['a', 'b']);
  sources = new Map<AttachmentSourceId, AttachmentMetadata>();
  payloads = new Map<string, Attachment>();
  byteReads: string[] = [];
  beforeRead?: Promise<void>;
  afterRead?: Promise<void>;
  failName?: string;
  source(name = 'file', size = 1, kind: 'file' | 'image' = 'file'): AttachmentSourceId {
    const id = `source-${++this.sequence}` as AttachmentSourceId;
    this.sources.set(id, { name, size, kind });
    return id;
  }
  assertAvailable(id: string): void { if (!this.available.has(id)) throw new Error('closed resource'); }
  async read(id: string, source: AttachmentSourceId, admit: (metadata: AttachmentMetadata) => void): Promise<Attachment> {
    await this.beforeRead;
    const metadata = this.sources.get(source)!;
    admit(metadata);
    if (metadata.name === this.failName) throw new Error('read failure');
    if (metadata.kind === 'image') this.byteReads.push(metadata.name);
    const item = { ...metadata, id: `token-${++this.sequence}` };
    this.payloads.set(`${id}/${item.id}`, item);
    await this.afterRead;
    return item;
  }
  release(id: string, tokens: readonly string[]): void { for (const token of tokens) this.payloads.delete(`${id}/${token}`); }
  discardSources(_id: string, sources: readonly AttachmentSourceId[]): void { for (const source of sources) this.sources.delete(source); }
}
function setup() {
  const resources = new FakeResources();
  const runtime = {
    send: vi.fn<(id: string, command: RuntimeSend) => Promise<void>>().mockResolvedValue(undefined),
    stop: vi.fn<(id: string) => Promise<void>>().mockResolvedValue(undefined),
    respond: vi.fn<(id: string, response: ExtensionResponse) => Promise<void>>().mockResolvedValue(undefined),
    rename: vi.fn<(id: string, name: string) => Promise<void>>().mockResolvedValue(undefined),
    fork: vi.fn<(id: string, entryId: string) => Promise<{ text: string; cancelled: boolean }>>().mockResolvedValue({ text: 'forked', cancelled: false }),
  } satisfies ConversationRuntimePort;
  const core = new ConversationApplication(runtime, resources);
  core.open('a'); core.open('b');
  const register = (...sources: AttachmentSourceId[]) => core.registerAttachments('a', sources);
  const send = (ids: string[] = [], delivery: Delivery = 'prompt', text = 'hello') => core.send('a', { text, attachmentIds: ids, delivery });
  return { core, resources, runtime, register, send };
}

describe('ConversationApplication send and attachment Interface', () => {
  it.each(['prompt', 'steer', 'followUp'] as const)('routes %s without activity or protocol objects, synchronously issuing typed send', async delivery => {
    const { runtime, send } = setup();
    const pending = send([], delivery);
    expect(runtime.send).toHaveBeenCalledWith('a', { text: 'hello', attachmentIds: [], queuePreference: delivery === 'followUp' ? 'followUp' : 'steer' });
    await pending;
  });

  it('has a closed typed runtime surface rather than an arbitrary command bag', () => {
    expectTypeOf<keyof ConversationRuntimePort>().toEqualTypeOf<'send' | 'stop' | 'respond' | 'rename' | 'fork'>();
    expectTypeOf<keyof RuntimeSend>().toEqualTypeOf<'text' | 'attachmentIds' | 'queuePreference'>();
    expectTypeOf<ReturnType<ConversationRuntimePort['stop']>>().toEqualTypeOf<Promise<void>>();
    expectTypeOf<{ id: string; command: string }>().not.toExtend<ExtensionResponse>();
    expectTypeOf<{ text: string; attachmentIds: string[]; queuePreference: 'abort' }>().not.toExtend<RuntimeSend>();
    expectTypeOf<keyof Attachment>().toEqualTypeOf<'id' | 'name' | 'size' | 'kind' | 'mimeType'>();
  });

  it('routes a stable Pi entry identity through the explicit fork capability', async () => {
    const { core, runtime } = setup();
    await expect(core.fork('a', 'entry-1')).resolves.toEqual({ text: 'forked', cancelled: false });
    expect(runtime.fork).toHaveBeenCalledExactlyOnceWith('a', 'entry-1');
  });

  it('rejects invalid delivery, empty content, duplicate IDs and oversized lists before runtime', async () => {
    const { send, runtime } = setup();
    await expect(send([], 'invalid' as Delivery)).rejects.toMatchObject({ code: 'INVALID_DELIVERY' });
    await expect(send([], 'prompt', ' \n ')).rejects.toMatchObject({ code: 'EMPTY_MESSAGE' });
    await expect(send(['x', 'x'])).rejects.toMatchObject({ code: 'INVALID_ATTACHMENTS' });
    await expect(send(Array.from({ length: 21 }, (_, i) => String(i)))).rejects.toMatchObject({ code: 'INVALID_ATTACHMENTS' });
    expect(runtime.send).not.toHaveBeenCalled();
  });

  it('allows attachment-only send but rejects cross-session, revoked and consumed tokens', async () => {
    const { core, resources, register, send } = setup();
    const [item, revoked] = await register(resources.source(), resources.source());
    await expect(core.send('b', { text: 'cross', attachmentIds: [item.id], delivery: 'prompt' })).rejects.toMatchObject({ code: 'ATTACHMENT_EXPIRED' });
    core.removeAttachment('a', revoked.id);
    await expect(send([revoked.id])).rejects.toMatchObject({ code: 'ATTACHMENT_EXPIRED' });
    await send([item.id], 'prompt', '');
    await expect(send([item.id])).rejects.toMatchObject({ code: 'ATTACHMENT_EXPIRED' });
    expect(resources.payloads.size).toBe(0);
  });

  it('copies selected sources and returned metadata instead of sharing business authority', async () => {
    const { core, resources, send } = setup();
    const sources = [resources.source('original')];
    const selection = core.registerAttachments('a', sources);
    sources.splice(0);
    const [item] = await selection;
    const id = item.id;
    Object.assign(item, { id: 'tampered', kind: 'image', size: 99 * MiB });
    await send([id]);
    expect(resources.sources.size).toBe(0);
  });

  it.each([
    { sizes: [5 * MiB + 1], code: 'IMAGE_TOO_LARGE', reads: 0 },
    { sizes: [1, 1, 1, 1, 1], code: 'TOO_MANY_IMAGES', reads: 4 },
    { sizes: [5 * MiB, 5 * MiB, 1], code: 'IMAGES_TOO_LARGE', reads: 2 },
  ])('checks image budget before bytes and rolls back failed batch: $code', async ({ sizes, code, reads }) => {
    const { resources, register } = setup();
    await expect(register(...sizes.map((size, i) => resources.source(`image-${i}`, size, 'image')))).rejects.toMatchObject({ code });
    expect(resources.byteReads).toHaveLength(reads);
    expect(resources.payloads.size).toBe(0);
    expect(resources.sources.size).toBe(0);
  });

  it('serializes concurrent image budgets and continues after rejection without leaking payloads', async () => {
    const { resources, register } = setup();
    const first = register(...Array.from({ length: 3 }, () => resources.source('first', 1, 'image')));
    const second = register(resources.source('second', 1, 'image'), resources.source('fifth', 1, 'image'));
    await first;
    await expect(second).rejects.toMatchObject({ code: 'TOO_MANY_IMAGES' });
    expect(resources.payloads.size).toBe(3);
    await register(resources.source('retry', 1, 'image'));
    expect(resources.payloads.size).toBe(4);
  });

  it('serializes the 20 attachment limit before any read, leaving previously registered tokens usable', async () => {
    const { resources, register, send } = setup();
    const first = register(...Array.from({ length: 20 }, () => resources.source()));
    const second = register(resources.source('excess'));
    const items = await first;
    await expect(second).rejects.toMatchObject({ code: 'TOO_MANY_ATTACHMENTS' });
    expect(resources.payloads.size).toBe(20);
    await send(items.map(item => item.id));
  });

  it('rolls back a later read failure without revoking an earlier batch, and remains retryable', async () => {
    const { resources, register, send } = setup();
    const [existing] = await register(resources.source('existing'));
    resources.failName = 'broken';
    await expect(register(resources.source('partial'), resources.source('broken'))).rejects.toThrow('read failure');
    expect([...resources.payloads.values()].map(item => item.name)).toEqual(['existing']);
    await register(resources.source('retry'));
    await send([existing.id]);
    expect([...resources.payloads.values()].map(item => item.name)).toEqual(['retry']);
  });

  it.each(['reject', 'throw'] as const)('single-send lock releases on runtime %s, preserves tokens and never replays', async mode => {
    const { resources, runtime, register, send } = setup();
    const [item] = await register(resources.source());
    const ack = deferred<void>();
    runtime.send.mockImplementationOnce(() => mode === 'throw' ? (() => { throw new Error('write failure'); })() : ack.promise);
    const sending = send([item.id]);
    const rejection = expect(sending).rejects.toThrow('write failure');
    if (mode === 'reject') {
      await expect(send([item.id])).rejects.toMatchObject({ code: 'SEND_PENDING' });
      ack.reject(new Error('write failure'));
    }
    await rejection;
    expect(runtime.send).toHaveBeenCalledTimes(1);
    expect(resources.payloads.size).toBe(1);
    await send([item.id]);
    expect(resources.payloads.size).toBe(0);
  });

  it('copies submitted IDs and consumes only acknowledged tokens, retaining new draft registration', async () => {
    const { resources, runtime, register, send } = setup();
    const [old] = await register(resources.source('old'));
    const ack = deferred<void>(); runtime.send.mockReturnValueOnce(ack.promise);
    const ids = [old.id]; const pending = send(ids); ids[0] = 'mutated';
    const [fresh] = await register(resources.source('fresh'));
    expect(runtime.send.mock.calls[0][1].attachmentIds).toEqual([old.id]);
    ack.resolve(); await pending;
    await expect(send([old.id])).rejects.toMatchObject({ code: 'ATTACHMENT_EXPIRED' });
    await send([fresh.id]);
  });

  it('revoking an in-flight chip does not cancel the already issued request', async () => {
    const { core, resources, runtime, register, send } = setup();
    const [item] = await register(resources.source());
    const ack = deferred<void>(); runtime.send.mockReturnValueOnce(ack.promise);
    const pending = send([item.id]); core.removeAttachment('a', item.id);
    expect(runtime.send.mock.calls[0][1].attachmentIds).toEqual([item.id]);
    expect(resources.payloads.size).toBe(0);
    ack.resolve(); await pending;
  });

  it.each(['before', 'after'] as const)('invalidates during %s read; late work cannot register into a reused ID', async timing => {
    const { core, resources, register, send } = setup();
    const pause = deferred<void>();
    if (timing === 'before') resources.beforeRead = pause.promise;
    else resources.afterRead = pause.promise;
    const pending = register(resources.source('late', 1, 'image'));
    const rejection = expect(pending).rejects.toMatchObject({ code: 'CLOSED' });
    await turns(); core.invalidate('a'); core.open('a');
    pause.resolve(); await rejection;
    expect(resources.payloads.size).toBe(0);
    expect(resources.sources.size).toBe(0);
    if (timing === 'before') expect(resources.byteReads).toEqual([]);
    resources.beforeRead = undefined; resources.afterRead = undefined;
    const [fresh] = await register(resources.source('fresh'));
    await send([fresh.id]);
  });

  it('late send acknowledgement cannot consume or unlock a new operation context or another session', async () => {
    const { core, resources, runtime, register, send } = setup();
    const [old] = await register(resources.source('old'));
    const oldAck = deferred<void>(); runtime.send.mockReturnValueOnce(oldAck.promise);
    const oldSend = send([old.id]); core.invalidate('a'); core.open('a');
    const [fresh] = await register(resources.source('fresh'));
    const [other] = await core.registerAttachments('b', [resources.source('other')]);
    const newAck = deferred<void>(); runtime.send.mockReturnValueOnce(newAck.promise);
    const newSend = send([fresh.id]);
    oldAck.resolve(); await oldSend;
    await expect(send([fresh.id])).rejects.toMatchObject({ code: 'SEND_PENDING' });
    expect(resources.payloads.has(`a/${fresh.id}`)).toBe(true);
    expect(resources.payloads.has(`b/${other.id}`)).toBe(true);
    newAck.resolve(); await newSend;
  });

  it('propagates extension and rename failures without manufacturing conversation state', async () => {
    const { core, runtime } = setup();
    const response = { id: 'dialog', value: 'yes' };
    const responseError = new Error('answer expired');
    const renameError = new Error('rename failed');
    runtime.respond.mockRejectedValueOnce(responseError);
    runtime.rename.mockRejectedValueOnce(renameError);
    await expect(core.respond('a', response)).rejects.toBe(responseError);
    await expect(core.rename('a', 'new')).rejects.toBe(renameError);
    await core.respond('a', { id: 'confirm', confirmed: false });
    expect(runtime.respond.mock.calls).toEqual([['a', response], ['a', { id: 'confirm', confirmed: false }]]);
    expect(runtime.rename).toHaveBeenCalledTimes(1);
  });

  it('stop, extension response and rename preserve asynchronous failures independently of the send lock', async () => {
    const { core, runtime, send } = setup();
    const ack = deferred<void>(); runtime.send.mockReturnValueOnce(ack.promise);
    const pending = send();
    runtime.stop.mockRejectedValueOnce(new Error('abort failed'));
    await expect(core.stop('a')).rejects.toThrow('abort failed');
    await core.stop('a');
    await core.respond('a', { id: 'dialog', cancelled: true });
    await core.rename('a', 'new name');
    expect(runtime.stop.mock.calls).toEqual([['a'], ['a']]);
    expect(runtime.respond).toHaveBeenCalledWith('a', { id: 'dialog', cancelled: true });
    expect(runtime.rename).toHaveBeenCalledWith('a', 'new name');
    await expect(send()).rejects.toMatchObject({ code: 'SEND_PENDING' });
    ack.resolve(); await pending;
  });
});
