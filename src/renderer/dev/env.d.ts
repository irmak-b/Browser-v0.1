import type { BrowserApi } from '../../shared/contracts';
declare global { interface Window { browser: BrowserApi } }
