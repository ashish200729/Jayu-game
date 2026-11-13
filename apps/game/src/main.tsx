import '@fontsource/baloo-2/500.css';
import '@fontsource/baloo-2/700.css';
import '@fontsource/baloo-2/800.css';
import '@fontsource/nunito/400.css';
import '@fontsource/nunito/600.css';
import '@fontsource/nunito/800.css';
import '@fontsource/noto-sans-devanagari/400.css';
import '@fontsource/noto-sans-devanagari/700.css';
import './styles.css';
import { createRoot } from 'react-dom/client';
import { App, boot } from '@game/ui/app';

void boot();
createRoot(document.getElementById('root')!).render(<App />);
document.getElementById('boot')?.remove();
