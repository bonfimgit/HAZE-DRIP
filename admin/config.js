/*
  Endereço da API usada pelo painel.
  - Em localhost/127.0.0.1: API local (npm start no backend)
  - Em produção: API publicada no Railway
  Pode ser sobrescrito definindo window.HAZE_API_URL antes deste arquivo.
*/
const HAZE_API_URL = window.HAZE_API_URL || (
  ['localhost', '127.0.0.1'].includes(window.location.hostname)
    ? 'http://localhost:3000'
    : 'https://hazedrip-production-6a67.up.railway.app'
);
