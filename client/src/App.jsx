import { Component, lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { WifiOff } from 'lucide-react';
import { useSession } from './lib/session.jsx';
import { useOnline } from './lib/gps.js';
import { Banner, Button, Spinner, Toasts } from './components/ui.jsx';
import Login from './pages/Login.jsx';
import { Terms, Privacy, Safety } from './pages/Legal.jsx';
import ConsentGate from './pages/ConsentGate.jsx';

const Home = lazy(() => import('./pages/Home.jsx'));
const Profile = lazy(() => import('./pages/Profile.jsx'));
const Match = lazy(() => import('./pages/Match.jsx'));
const Admin = lazy(() => import('./pages/Admin.jsx'));

class Boundary extends Component {
  state = { err: null };
  static getDerivedStateFromError(err) { return { err }; }
  render() {
    if (!this.state.err) return this.props.children;
    return <div className="min-h-dvh grid place-items-center p-6 text-center"><div><h1 className="font-display text-3xl font-bold mb-2">Something broke</h1><p className="text-sage mb-4">Your match is safe on the server. Reload to rejoin.</p><Button onClick={() => location.reload()}>Reload</Button></div></div>;
  }
}

function Private({ children }) {
  const { user, loading } = useSession();
  const loc = useLocation();
  if (loading) return <Spinner label="Starting up" />;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  if (!user.consentCurrent) return <ConsentGate />;
  return children;
}

export default function App() {
  const { loading, error, toasts, conn, user } = useSession();
  const online = useOnline();
  const { pathname } = useLocation();
  const inMatch = /^\/m\//.test(pathname);
  const bannerPos = inMatch ? 'bottom-[calc(env(safe-area-inset-bottom)+5.25rem)]' : 'bottom-3';
  if (loading) return <Spinner label="Starting up" />;
  if (error) return <div className="min-h-dvh grid place-items-center p-6 text-center"><div><h1 className="font-display text-3xl font-bold mb-2">Server unreachable</h1><p className="text-sage mb-4">{error}</p><Button onClick={() => location.reload()}>Try again</Button></div></div>;
  return (
    <Boundary>
      <Toasts toasts={toasts} inMatch={inMatch} />
      {!online && <div className={`fixed z-[70] ${bannerPos} inset-x-3 flex justify-center`}><Banner tone="bad" className="max-w-md w-full"><span className="inline-flex items-center gap-2"><WifiOff className="size-4" />You are offline. The match continues on the server, reconnecting…</span></Banner></div>}
      {online && user && conn === 'offline' && <div className={`fixed z-[70] ${bannerPos} inset-x-3 flex justify-center`}><Banner tone="warn" className="max-w-md w-full">Connection lost. Reconnecting…</Banner></div>}
      <Suspense fallback={<Spinner />}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/terms" element={<Terms />} /><Route path="/privacy" element={<Privacy />} /><Route path="/safety" element={<Safety />} />
          <Route path="/" element={<Private><Home /></Private>} />
          <Route path="/settings" element={<Private><Profile /></Private>} />
          <Route path="/m/:code/*" element={<Private><Match /></Private>} />
          <Route path="/join/:code" element={<Private><Home /></Private>} />
          <Route path="/admin/*" element={<Private><Admin /></Private>} />
          <Route path="*" element={<div className="min-h-dvh grid place-items-center text-center p-6"><div><h1 className="font-display text-5xl font-bold">Lost signal</h1><p className="text-sage my-3">That page does not exist.</p><a className="text-lime underline" href="/">Back to base</a></div></div>} />
        </Routes>
      </Suspense>
    </Boundary>
  );
}
