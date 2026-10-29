import { useState } from 'react';
import type { Session, WebRuntime } from '../runtime/WebRuntime';

/**
 * Sign-in goes to the EXISTING novaflow-backend, unchanged. A Web login and a
 * Desktop login are the same account, the same credits and the same session
 * format - the Web line added no auth of its own.
 */
export function LoginDialog({ runtime, onSignedIn }: {
  runtime: WebRuntime;
  onSignedIn: (session: Session) => void;
}) {
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      onSignedIn(await runtime.login(account.trim(), password));
    } catch (err) {
      setError(String((err as Error).message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="nf-backdrop">
      <form className="nf-dialog" onSubmit={submit}>
        <div className="nf-brand" style={{ justifyContent: 'center', marginBottom: 2 }}>
          <img className="nf-brand-logo" src="/assets/foart-logo-dark.svg" alt="Foart" />
        </div>
        <p style={{ textAlign: 'center' }}>
          使用你的 Foart 账号登录。无需安装任何软件，生成在远程 GPU 算力节点上完成。
        </p>

        <div className="nf-field">
          <label className="nf-label" htmlFor="nf-account">账号</label>
          <input
            id="nf-account"
            className="nf-input"
            autoComplete="username"
            value={account}
            onChange={(e) => setAccount(e.target.value)}
            placeholder="邮箱或用户名"
            required
          />
        </div>

        <div className="nf-field">
          <label className="nf-label" htmlFor="nf-password">密码</label>
          <input
            id="nf-password"
            className="nf-input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>

        {error && <div className="nf-error">{error}</div>}

        <button className="nf-button primary block" type="submit" disabled={busy || !account || !password}>
          {busy ? <><i className="fa-solid fa-circle-notch nf-spin" /> 登录中…</> : '登录'}
        </button>

        {runtime.isLocalControlPlane && (
          <button
            type="button"
            className="nf-button block"
            disabled={busy}
            title="仅在本地控制面可用，不会出现在线上构建里"
            onClick={async () => {
              setError('');
              setBusy(true);
              try {
                onSignedIn(await runtime.devLogin(account.trim() || 'demo@novaflow.local', 1000));
              } catch (err) {
                setError(String((err as Error).message));
              } finally {
                setBusy(false);
              }
            }}
          >
            <i className="fa-solid fa-flask" /> 本地验收登录
          </button>
        )}

        <div className="nf-meta" style={{ textAlign: 'center' }}>
          登录接口：<b>{new URL(runtime.authUrl).host}</b>
          <br />算力调度：<b>{safeHost(runtime.controlUrl)}</b>
        </div>
      </form>
    </div>
  );
}

function safeHost(url: string) {
  try { return new URL(url).host; } catch { return url; }
}
