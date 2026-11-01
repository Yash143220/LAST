import { useEffect } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useMatch, useSession } from '../lib/session.jsx';
import { Button, Spinner } from '../components/ui.jsx';
import Lobby from './Lobby.jsx';
import Setup from './Setup.jsx';
import Game from './Game.jsx';
import Results from './Results.jsx';

export default function Match() {
  const code = (useParams().code || '').toUpperCase();
  const loc = useLocation();
  const { setActiveGame } = useSession();
  const m = useMatch(code);
  const { state, error, closed } = m;

  useEffect(() => { if (state) setActiveGame(state.status === 'finished' ? null : code); }, [state?.status, code]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (closed) setActiveGame(null); }, [closed]); // eslint-disable-line react-hooks/exhaustive-deps

  if (closed) return <Gone title={closed === 'kicked' ? 'You were removed' : 'This match is over'} text={closed === 'kicked' ? 'The host removed you from the lobby.' : 'The lobby was closed or expired.'} />;
  if (error && !state) return <Gone title="Cannot join" text={error.error} />;
  if (!state) return <Spinner label={`Joining ${code}`} />;
  if (state.status === 'lobby') return loc.pathname.endsWith('/setup') && state.isHost ? <Setup state={state} /> : <Lobby state={state} />;
  if (state.status === 'finished') return <Results state={state} />;
  return <Game {...m} />;
}

function Gone({ title, text }) {
  return <main className="min-h-dvh grid place-items-center p-6 text-center"><div><h1 className="font-display text-4xl font-bold mb-2">{title}</h1><p className="text-sage mb-5">{text}</p><Link to="/"><Button>Back to base</Button></Link></div></main>;
}
