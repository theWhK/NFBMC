// Lista as falas do modo história em JSON (o scripts/vozes.py lê daqui).
// Uso: node scripts/falas.ts
import { storyVoiceLines } from "../shared/src/index.ts";

process.stdout.write(JSON.stringify(storyVoiceLines(), null, 1));
