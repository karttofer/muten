// SPA entry (scaffolded): boot the Muten app — the shell + hash router generated from app.muten.
import './styles.css';                  // your look (Muten ships structure + layout; styling lives here)
import { start } from 'virtual:muten/app';

start(document.getElementById('app'));
