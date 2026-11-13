import './ui/styles.css';
import { mountStart } from './ui/start';

const params = new URLSearchParams(location.search);

mountStart(document.getElementById('app')!, {
  // The launch and the live flight arrive with the 3D scene (Task 16).
  onLetGo() {},
  onOpenBalloon() {},
}, { backdrop: params.get('backdrop') });
