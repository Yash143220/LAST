import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

const OP = import.meta.env.VITE_OPERATOR_NAME || 'the Operation: Outbreak operator';
const MAIL = import.meta.env.VITE_CONTACT_EMAIL || 'support@example.com';
const UPDATED = '1 November 2026';

function Doc({ title, children }) {
  const nav = useNavigate();
  return (
    <main className="max-w-2xl mx-auto px-5 pb-16 safe-top">
      <button onClick={() => (history.length > 1 ? nav(-1) : nav('/'))} className="mt-4 mb-6 inline-flex items-center gap-2 text-sage hover:text-text"><ArrowLeft className="size-4" />Back</button>
      <h1 className="font-display text-4xl font-bold">{title}</h1>
      <p className="text-sm text-sage mt-1 mb-6">Last updated {UPDATED}</p>
      <div className="space-y-4 text-text/90 leading-relaxed [&_h2]:font-display [&_h2]:text-2xl [&_h2]:font-bold [&_h2]:mt-8 [&_h2]:text-lime [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1 [&_a]:text-lime [&_a]:underline">{children}</div>
      <nav className="mt-10 flex gap-4 text-sm text-sage"><Link to="/terms">Terms</Link><Link to="/privacy">Privacy</Link><Link to="/safety">Safety rules</Link></nav>
    </main>
  );
}

export const Terms = () => (
  <Doc title="Terms & Conditions">
    <p>These terms govern your use of Operation: Outbreak ("the Game"), operated by {OP}. By creating an account you agree to them.</p>
    <h2>Playing safely is a condition of play</h2>
    <p>The Game is played in the real world. You are solely responsible for where you walk. You must follow the <Link to="/safety">Safety Rules</Link>. We may suspend accounts that put others at risk.</p>
    <h2>Your account</h2>
    <ul><li>You sign in with Google. Keep your Google account secure; you are responsible for activity on your account.</li><li>Choose a callsign that is not offensive or impersonating anyone.</li><li>You must be 16 or older, or play with a parent or guardian's permission and supervision.</li></ul>
    <h2>Fair play</h2>
    <ul><li>No spoofing GPS, scripts, bots or tampering with the app or servers (simulated GPS is allowed only in matches where the host enables practice mode).</li><li>No harassment, chasing, physical contact or trespassing. Infections are confirmed by QR code, never by touching.</li><li>Hosts must review and approve every checkpoint for safety before starting a match.</li></ul>
    <h2>Hosts</h2>
    <p>Hosts choose the play area and checkpoints and are responsible for ensuring they are open, public, pedestrian-safe and permitted. Do not place checkpoints on private property, roads, railways, or inside buildings.</p>
    <h2>Availability and changes</h2>
    <p>The Game is provided "as is". GPS accuracy depends on your device and surroundings; the Game cannot guarantee exact distances. We may change or discontinue features and will update these terms when we do.</p>
    <h2>Liability</h2>
    <p>To the extent permitted by law, we are not liable for injury, loss or damage arising from playing in the real world, or for indirect or consequential loss. Nothing limits liability that cannot be limited by law.</p>
    <h2>Ending your account</h2>
    <p>You can delete your account at any time in Settings. We may suspend or remove accounts that break these terms.</p>
    <h2>Contact</h2>
    <p><a href={`mailto:${MAIL}`}>{MAIL}</a></p>
  </Doc>
);

export const Privacy = () => (
  <Doc title="Privacy Policy">
    <p>This policy explains what {OP} collects when you use Operation: Outbreak and why.</p>
    <h2>What we collect</h2>
    <ul>
      <li><b>Account:</b> your Google email, name and profile photo (from Google sign-in), your public callsign and optional profile picture, and a record of the agreements you accepted and when.</li>
      <li><b>Gameplay:</b> matches you join, your role, missions, items, infections, scores and aggregate statistics.</li>
      <li><b>Location:</b> your phone's GPS position while you are in a running match. Opponents only ever see an approximate area; teammates may see your position. Live positions are held in server memory for the match and are <b>not stored in your history</b>. Matches are saved without coordinates.</li>
      <li><b>Safety reports:</b> if you send a report, we store the type, your note, your name and the approximate location.</li>
      <li><b>Technical:</b> IP address and request logs for security and abuse prevention, and a session cookie that keeps you signed in.</li>
    </ul>
    <h2>Why we use it</h2>
    <p>To run matches, keep the Game fair and safe, show your profile and stats, and investigate abuse and safety reports. We do not sell personal data and do not show ads.</p>
    <h2>Who receives it</h2>
    <ul><li>Other players in your match (callsign, picture, and location as described above).</li><li>Google (sign-in).</li><li>OpenFreeMap serves the map tiles, so your IP address and viewed map area are visible to them. The place search in the host setup uses OpenStreetMap Nominatim.</li><li>Our hosting and database providers, who process data for us.</li></ul>
    <h2>How long we keep it</h2>
    <ul><li>Account data: until you delete your account.</li><li>Match results (without coordinates): up to 12 months, then deleted. When you delete your account, your entries are anonymised.</li><li>Safety reports: up to 180 days.</li><li>Admin audit logs: up to 12 months.</li></ul>
    <h2>Your choices and rights</h2>
    <ul><li>Change your callsign and picture in Settings at any time.</li><li>Download your data in Settings (JSON).</li><li>Delete your account and personal data in Settings. This is immediate and permanent.</li><li>You may have further rights (access, correction, objection, complaint to a supervisory authority) depending on where you live. Contact us to use them.</li></ul>
    <h2>Children</h2>
    <p>The Game is for people aged 16+, or younger players with a parent/guardian's permission.</p>
    <h2>Contact</h2>
    <p><a href={`mailto:${MAIL}`}>{MAIL}</a></p>
  </Doc>
);

export const Safety = () => (
  <Doc title="Safety Rules">
    <p>Operation: Outbreak is a walking game. Nothing in it is worth an injury.</p>
    <h2>Always</h2>
    <ul><li><b>Walk. Never run</b> or chase. There is no physical contact in this game.</li><li>Look up. Do not stare at your phone while moving, crossing streets, or on stairs.</li><li>Stay in <b>open, public, pedestrian-friendly outdoor areas</b>.</li><li>Play in daylight or well-lit areas, in groups where possible, and tell someone where you are playing.</li><li>Keep to the park rules, local laws and the rights of other people around you.</li></ul>
    <h2>Never</h2>
    <ul><li>Enter buildings, malls, stations, campuses or private property to complete a task.</li><li>Step onto roads, railway tracks, platforms, vehicle entrances, construction sites, or water edges.</li><li>Approach, hide near or alarm members of the public who are not playing.</li></ul>
    <h2>If something is wrong</h2>
    <ul><li>Use <b>Report / Safety pause</b> in the match menu. It alerts the host and pauses the match for everyone.</li><li>For any emergency, call your local emergency number first.</li><li>You can leave a match at any time.</li></ul>
    <h2>Hosts</h2>
    <p>Before starting, visit or carefully review each checkpoint. Confirm it is outdoors, publicly accessible, away from traffic and railways, and not private property. Do not rely only on the map's automatic warnings, they are a helper, not a guarantee.</p>
  </Doc>
);
