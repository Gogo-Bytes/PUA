import { useEffect, useRef, useState } from 'react';
import { desktopClient } from '../../app/desktop-client';
import type { SessionFileListing, SessionFilePreview, SessionInfo } from '../../../shared/ipc/desktop-api';
import { Button, Icon, IconButton } from '../../ui';

export function FilesPanel({ task }: { task?: SessionInfo }) {
  const [directory, setDirectory] = useState('');
  const [listing, setListing] = useState<SessionFileListing>();
  const [preview, setPreview] = useState<SessionFilePreview>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const requestSequence = useRef(0);

  useEffect(() => {
    let current = true;
    const request = ++requestSequence.current;
    setDirectory(''); setPreview(undefined); setListing(undefined); setError('');
    if (!task) return () => { current = false; };
    setLoading(true);
    void desktopClient.listSessionFiles(task.id, '').then(value => { if (current && request === requestSequence.current) setListing(value); })
      .catch(reason => { if (current && request === requestSequence.current) setError(String(reason)); })
      .finally(() => { if (current && request === requestSequence.current) setLoading(false); });
    return () => { current = false; };
  }, [task?.id]);

  const navigate = (next: string) => {
    if (!task) return;
    const request = ++requestSequence.current;
    setDirectory(next); setPreview(undefined); setError(''); setLoading(true);
    void desktopClient.listSessionFiles(task.id, next).then(value => { if (request === requestSequence.current) setListing(value); }).catch(reason => { if (request === requestSequence.current) setError(String(reason)); }).finally(() => { if (request === requestSequence.current) setLoading(false); });
  };
  const openFile = (entryPath: string) => {
    if (!task) return;
    const request = ++requestSequence.current;
    setError(''); setLoading(true);
    void desktopClient.readSessionFile(task.id, entryPath).then(value => { if (request === requestSequence.current) setPreview(value); }).catch(reason => { if (request === requestSequence.current) setError(String(reason)); }).finally(() => { if (request === requestSequence.current) setLoading(false); });
  };
  const breadcrumbs = directory ? directory.split('/') : [];
  const goToBreadcrumb = (index: number) => navigate(breadcrumbs.slice(0, index + 1).join('/'));

  if (!task) return <div className="workspace-panel-unavailable"><Icon name="folder"/><h2>Files</h2><p>发送第一条消息创建会话后，即可浏览该项目文件。</p></div>;
  return <section className="workspace-files" aria-label="工作区文件">
    <header className="workspace-files-toolbar">
      {preview ? <>
        <IconButton icon="back" label="返回文件列表" variant="ghost" onClick={() => setPreview(undefined)}/>
        <div className="workspace-files-path" title={preview.path}><Icon name="file"/><span>{preview.path}</span></div>
      </> : <>
        <IconButton icon="back" label="上级目录" variant="ghost" disabled={!directory} onClick={() => navigate(breadcrumbs.slice(0, -1).join('/'))}/>
        <nav className="workspace-files-path" aria-label="目录路径">
          <button type="button" onClick={() => navigate('')}>{task.cwd.split(/[\\/]/).filter(Boolean).at(-1) || task.cwd}</button>
          {breadcrumbs.map((part, index) => <span key={`${index}-${part}`} className="workspace-files-crumb"><span aria-hidden="true">/</span><button type="button" onClick={() => goToBreadcrumb(index)}>{part}</button></span>)}
        </nav>
        <IconButton icon="refresh" label="刷新目录" variant="ghost" onClick={() => navigate(directory)}/>
      </>}
    </header>
    {error && <div className="workspace-files-message" role="alert">{error}</div>}
    {loading ? <div className="workspace-files-message" role="status">正在读取…</div>
      : preview ? <div className="workspace-files-preview"><pre>{preview.text || '（空文件）'}</pre>{preview.truncated && <p>文件较大，仅显示前 256 KB。</p>}</div>
      : listing && <div className="workspace-files-list" aria-label="文件和目录">
        {listing.entries.map(entry => <Button key={entry.path} variant="ghost" className="workspace-files-entry" onClick={() => entry.kind === 'directory' ? navigate(entry.path) : openFile(entry.path)}>
          <Icon name={entry.kind === 'directory' ? 'folder' : 'file'}/><span>{entry.name}</span>{entry.kind === 'directory' && <Icon name="chevron"/>}
        </Button>)}
        {!listing.entries.length && <div className="workspace-files-message">此目录为空</div>}
        {listing.truncated && <div className="workspace-files-message">仅显示前 500 项</div>}
      </div>}
  </section>;
}
