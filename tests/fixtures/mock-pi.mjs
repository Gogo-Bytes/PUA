const args = process.argv.slice(2);
if (args.includes('--mode') && args[args.indexOf('--mode') + 1] === 'rpc') runRpc();
else runTerminal();

function runTerminal() {
  process.stdin.setRawMode?.(true);
  process.stdin.resume();
  process.stdout.write('\x1b[?2004h\x1b[32mMOCK_PI_READY\x1b[0m\r\n');
  process.stdout.write(`CWD=${process.cwd()}\r\nARGS=${JSON.stringify(args)}\r\n`);
  let received = '';
  process.stdin.on('data', chunk => {
    const data = chunk.toString('utf8'); received += data;
    if (data.includes('\x04')) process.exit(0);
    if (data.includes('\x02')) { process.stdout.write(`\r\nINPUT_BASE64=${Buffer.from(received.replaceAll('\x02', '')).toString('base64')}\r\n`); received = ''; }
    if (data.includes('\x07')) { for (let index = 0; index < 15000; index++) process.stdout.write(`flow-${index.toString().padStart(5, '0')}\r\n`); process.stdout.write('FLOW_COMPLETE\r\n'); }
  });
  process.on('SIGWINCH', () => process.stdout.write(`SIZE=${process.stdout.columns}x${process.stdout.rows}\r\n`));
}

function runRpc() {
  let buffer = '';
  let running = false;
  let dialogCommand;
  let startupReady = process.env.PUA_MOCK_STARTUP_DIALOG !== '1';
  const startupCommands = [];
  const queue = { steering: [], followUp: [] };
  const send = value => process.stdout.write(`${JSON.stringify(value)}\n`);
  process.stdin.setEncoding('utf8'); process.stdin.resume();
  process.stdin.on('data', chunk => { buffer += chunk; while (buffer.includes('\n')) { const index = buffer.indexOf('\n'); const line = buffer.slice(0, index).replace(/\r$/, ''); buffer = buffer.slice(index + 1); if (line) handle(JSON.parse(line)); } });
  function response(command, data) { send({ id: command.id, type: 'response', command: command.type, success: true, ...(data === undefined ? {} : { data }) }); }
  function settle() { running = false; send({ type: 'agent_end', messages: [], willRetry: false }); send({ type: 'agent_settled' }); }
  function handle(command) {
    if (!startupReady && ['get_state', 'get_messages', 'get_commands'].includes(command.type)) {
      startupCommands.push(command);
      if (startupCommands.length === 1) send({ type: 'extension_ui_request', id: 'startup-dialog', method: 'confirm', title: '启动确认', message: '离线启动测试', timeout: 0 });
      return;
    }
    if (command.type === 'extension_ui_response' && command.id === 'startup-dialog') { startupReady = true; for (const pending of startupCommands.splice(0)) handle(pending); return; }

    if (command.type === 'get_state') return response(command, { model: { provider: 'mock', id: 'offline-model' }, thinkingLevel: 'medium', isStreaming: running, isCompacting: false, sessionId: 'mock-session', messageCount: 0, pendingMessageCount: 0 });
    if (command.type === 'get_messages') return response(command, { messages: [] });
    if (command.type === 'get_commands') { send({ type: 'extension_ui_request', id: 'startup-status', method: 'setStatus', statusKey: 'fixture', statusText: 'startup status retained' }); return response(command, { commands: [{ name: 'mock-dialog', description: '打开测试扩展对话', source: 'extension', sourceInfo: {} }] }); }
    if (command.type === 'set_session_name') return response(command);
    if (command.type === 'clear_queue') { const data = { steering: [...queue.steering], followUp: [...queue.followUp] }; queue.steering = []; queue.followUp = []; send({ type: 'queue_update', ...queue }); return response(command, data); }
    if (command.type === 'abort') { response(command); return settle(); }
    if (command.type === 'steer') { queue.steering.push(command.message); send({ type: 'queue_update', ...queue }); return response(command); }
    if (command.type === 'follow_up') { queue.followUp.push(command.message); send({ type: 'queue_update', ...queue }); return response(command); }
    if (command.type === 'extension_ui_response') { send({ type: 'extension_ui_request', id: 'notice-1', method: 'notify', message: command.cancelled ? '已取消测试对话' : `测试选择：${command.value ?? command.confirmed}`, notifyType: 'info' }); if (dialogCommand) { response(dialogCommand); dialogCommand = undefined; } return; }
    if (command.type !== 'prompt') return send({ id: command.id, type: 'response', command: command.type, success: false, error: 'unsupported' });
    if (command.message.trim() === '/mock-exit') { response(command); return setTimeout(() => process.exit(0), 50); }
    if (command.message.trim() === '/mock-zero') { dialogCommand = command; send({ type: 'extension_ui_request', id: 'zero', method: 'input', title: '零超时输入', timeout: 0 }); return; }
    if (command.message.trim() === '/mock-scroll') {
      response(command); running = true; send({ type: 'agent_start' });
      let text = '## Long streaming reply\n\n'; let count = 0;
      send({ type: 'message_start', message: { role: 'assistant', content: [], timestamp: Date.now() } });
      const timer = setInterval(() => {
        const delta = `Paragraph ${++count}: readable streaming content.\n\n`; text += delta;
        send({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: count === 1 ? '## Long streaming reply\n\n' + delta : delta } });
        if (count < 100) return;
        clearInterval(timer);
        send({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text }, { type: 'toolCall', id: 'scroll-tool', name: 'read', arguments: { path: 'long.txt' } }], timestamp: Date.now() } });
        send({ type: 'tool_execution_end', toolCallId: 'scroll-tool', toolName: 'read', result: { content: [{ type: 'text', text: 'exact tool output\nsecond line\n' }, { type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aU1sAAAAASUVORK5CYII=' }] }, isError: false });
        settle();
      }, 80);
      return;
    }
    if (command.message.trim() === '/mock-dialog') { dialogCommand = command; send({ type: 'extension_ui_request', id: `dialog-${Date.now()}`, method: 'select', title: '选择测试结果', options: ['通过', '失败'] }); return; }
    if (command.message.trim() === '/mock-timeout') { dialogCommand = command; send({ type: 'extension_ui_request', id: `timeout-${Date.now()}`, method: 'input', title: '限时输入', timeout: 200 }); setTimeout(() => { if (dialogCommand) { response(dialogCommand); dialogCommand = undefined; } }, 200); return; }
    if (command.message.trim() === '/mock-prefill') { send({ type: 'extension_ui_request', id: 'prefill', method: 'set_editor_text', text: '预填草稿' }); return response(command); }
    if (running) { queue[command.streamingBehavior === 'followUp' ? 'followUp' : 'steering'].push(command.message); send({ type: 'queue_update', ...queue }); return response(command); }
    running = true;
    response(command);
    send({ type: 'message_start', message: { role: 'user', content: [{ type: 'text', text: command.message }, ...(command.images || [])], timestamp: Date.now() } });
    send({ type: 'message_end', message: { role: 'user', content: [{ type: 'text', text: command.message }, ...(command.images || [])], timestamp: Date.now() } });
    send({ type: 'agent_start' });
    send({ type: 'message_start', message: { role: 'assistant', content: [], provider: 'mock', model: 'offline-model', stopReason: 'pending', timestamp: Date.now() } });
    send({ type: 'message_update', usage: {}, assistantMessageEvent: { type: 'text_start', contentIndex: 0 } });
    send({ type: 'message_update', usage: {}, assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: '## 原生回复\n\n这是 **流式** Markdown。\n\n```ts\n' } });
    send({ type: 'message_update', usage: {}, assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'const ready = true;\n```' } });
    send({ type: 'message_update', usage: {}, assistantMessageEvent: { type: 'toolcall_start', contentIndex: 1, id: 'tool-a', toolName: 'read' } });
    send({ type: 'message_update', usage: {}, assistantMessageEvent: { type: 'toolcall_end', contentIndex: 1, toolCall: { type: 'toolCall', id: 'tool-a', name: 'read', arguments: { path: 'README.md' } } } });
    send({ type: 'tool_execution_start', toolCallId: 'tool-a', toolName: 'read', args: { path: 'README.md' } });
    send({ type: 'message_update', assistantMessageEvent: { type: 'toolcall_end', contentIndex: 2, toolCall: { type: 'toolCall', id: 'tool-b', name: 'bash', arguments: { command: 'echo stale' } } } });
    send({ type: 'message_update', assistantMessageEvent: { type: 'toolcall_start', contentIndex: 3, id: 'provisional-removed', toolName: 'ghost' } });
    send({ type: 'tool_execution_update', toolCallId: 'tool-b', toolName: 'bash', partialResult: { content: [{ type: 'text', text: 'stale output' }] } });
    send({ type: 'tool_execution_end', toolCallId: 'tool-b', toolName: 'bash', result: { content: [] }, isError: true });
    send({ type: 'tool_execution_update', toolCallId: 'tool-a', toolName: 'read', args: { path: 'README.md' }, partialResult: { content: [{ type: 'text', text: 'partial' }], details: {} } });
    send({ type: 'tool_execution_end', toolCallId: 'tool-a', toolName: 'read', result: { content: [{ type: 'text', text: 'README content' }], details: {} }, isError: false });
    const assistant = { role: 'assistant', content: [{ type: 'text', text: '## 原生回复\n\n这是 **流式** Markdown。\n\n```ts\nconst ready = true;\n```' }, { type: 'toolCall', id: 'tool-a', name: 'read', arguments: { path: 'README.md' } }, { type: 'toolCall', id: 'tool-b', name: 'bash', arguments: { command: 'printf final-authoritative' } }], provider: 'mock', model: 'offline-model', usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: 'stop', timestamp: Date.now() };
    send({ type: 'message_end', message: assistant });
    send({ type: 'tool_execution_end', toolCallId: 'provisional-removed', toolName: 'ghost', result: { content: [{ type: 'text', text: 'must not resurrect' }] }, isError: false });
    send({ type: 'message_end', message: { role: 'toolResult', toolCallId: 'tool-a', toolName: 'read', content: [{ type: 'text', text: 'README content' }], isError: false, timestamp: Date.now() } });
    if (command.message.includes('slow')) return;
    settle();
  }
}
