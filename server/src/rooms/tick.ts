/**
 * Avança a simulação pelo tempo real que passou, em passos de no máximo 50 ms.
 * Se o servidor ficar apertado e um tick atrasar, o jogo não "anda em câmera
 * lenta": a contagem, as voltas e a física continuam em tempo real. (Atrasos
 * absurdos, como o processo pausado, ficam limitados a 1 s.)
 */
export function realTimeSteps(update: (dt: number) => void) {
  return (deltaMs: number) => {
    let left = Math.min(deltaMs, 1000);
    while (left > 0) {
      const step = Math.min(left, 50);
      update(step / 1000);
      left -= step;
    }
  };
}
