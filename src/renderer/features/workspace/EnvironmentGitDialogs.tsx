import { useRef } from 'react';
import { Button, Dialog, Input } from '../../ui';
import type { EnvironmentGitIntent, EnvironmentGitView } from './environment-view';

/** Confirmation is bound to its captured target; this view has no Git execution capability. */
export function EnvironmentGitDialogs({ view, onIntent }: { view: EnvironmentGitView; onIntent(intent: EnvironmentGitIntent): void }) {
  const messageInput = useRef<HTMLInputElement>(null);
  const { confirmation, busy, error } = view;
  const cancel = () => onIntent({ type: 'cancel' });
  return (
    <>
      <Dialog
        open={confirmation?.kind === 'delete-branch'}
        title="删除本地分支？"
        closeLabel="取消"
        closeDisabled={busy}
        closeOnBackdrop={!busy}
        onClose={cancel}
      >
        <p>
          将尝试安全删除 <strong>{confirmation?.kind === 'delete-branch' ? confirmation.target : ''}</strong>
          。如果分支包含尚未合并的提交，Git 会拒绝删除；不会强制删除。
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <Button disabled={busy} onClick={cancel}>
            取消
          </Button>
          <Button variant="primary" busy={busy} onClick={() => onIntent({ type: 'confirm-delete' })}>
            删除分支
          </Button>
        </div>
      </Dialog>
      <Dialog
        open={confirmation?.kind === 'delete-worktree'}
        title="移除工作树？"
        closeLabel="取消"
        closeDisabled={busy}
        closeOnBackdrop={!busy}
        onClose={cancel}
      >
        <p>
          将尝试移除 <strong>{confirmation?.kind === 'delete-worktree' ? confirmation.target : ''}</strong>
          。只有干净的非当前工作树可以移除，不会强制删除未提交文件。
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <Button disabled={busy} onClick={cancel}>
            取消
          </Button>
          <Button variant="primary" busy={busy} onClick={() => onIntent({ type: 'confirm-delete' })}>
            移除工作树
          </Button>
        </div>
      </Dialog>
      <Dialog
        open={confirmation?.kind === 'commit'}
        title="Commit or push"
        closeLabel="取消"
        initialFocusRef={messageInput}
        closeDisabled={busy}
        closeOnBackdrop={!busy}
        onClose={cancel}
      >
        {confirmation?.kind === 'commit' && confirmation.fileCount > 0 ? (
          <>
            <p>将把当前工作区的全部改动加入本地提交。请确认提交说明。</p>
            <Input
              ref={messageInput}
              aria-label="提交说明"
              placeholder="例如：修复侧栏交互"
              maxLength={2000}
              value={confirmation.message}
              disabled={busy}
              onChange={event => onIntent({ type: 'edit-message', value: event.target.value })}
            />
          </>
        ) : (
          <p>当前工作区没有未提交改动，可以推送当前分支的已有提交。</p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <Button disabled={busy} onClick={() => onIntent({ type: 'push' })}>
            推送
          </Button>
          {confirmation?.kind === 'commit' && confirmation.fileCount > 0 && (
            <>
              <Button disabled={busy || !confirmation.message.trim()} onClick={() => onIntent({ type: 'commit', push: false })}>
                提交
              </Button>
              <Button
                variant="primary"
                busy={busy}
                disabled={!confirmation.message.trim()}
                onClick={() => onIntent({ type: 'commit', push: true })}
              >
                提交并推送
              </Button>
            </>
          )}
        </div>
      </Dialog>
    </>
  );
}
