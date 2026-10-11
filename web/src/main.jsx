import { createRoot } from 'react-dom/client';
import '@fontsource-variable/vazirmatn';
import './styles.css';
import './voice.css';
import './theme.css';
import './features.css';
import App from './App';
import './update';

createRoot(document.getElementById('root')).render(<App />);
