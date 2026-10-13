// Calculadora de la ley de Ohm (página de teoría)
(function () {
  const v = document.getElementById('ov');
  const r = document.getElementById('or');
  const out = document.getElementById('oo');

  function calcular() {
    const V = parseFloat(v.value);
    const R = parseFloat(r.value);
    if (!(V >= 0) || !(R > 0)) {
      out.textContent = 'Escribe un voltaje (0 o más) y una resistencia mayor que cero.';
      return;
    }
    const I = V / R;
    const P = V * I;
    out.innerHTML =
      'Corriente: <strong>' + I.toFixed(4) + ' A</strong> (' + (I * 1000).toFixed(1) + ' mA)<br>' +
      'Potencia: <strong>' + P.toFixed(3) + ' W</strong>';
  }

  v.addEventListener('input', calcular);
  r.addEventListener('input', calcular);
  calcular();
})();
