// Música ambiental de Pinceladas de Vida.
//
// Genera un piano suave con Web Audio (sin archivos ni red): notas lentas
// de una escala pentatónica, con ataque suave y caída larga, como un piano
// ambiental de fondo.
//
// La música suena únicamente mientras la obra está abierta: gamelogic.js
// llama a preparar() dentro del gesto de clic (política de autoplay), a
// iniciar() al abrir la experiencia y a detener() al salir, siempre con
// fundidos suaves.
//
// Si más adelante se quiere una pista real, basta con reemplazar este
// módulo por un <audio> con su archivo.
//
// Interfaz publicada: el global `Musica` con:
//   - preparar(): crea/reanuda el contexto de audio (sin sonido todavía).
//   - iniciar(): arranca la música con fundido de entrada.
//   - detener(): la apaga con fundido de salida.

const Musica = (function () {
    "use strict";

    // Notas suaves (pentatónica de C / A menor ambiental).
    const NOTAS = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25];
    const VOLUMEN = 0.4; // piano suave de fondo

    let contexto = null;
    let maestro = null;
    let reproduciendo = false;
    let temporizador = null;

    function asegurarContexto() {
        if (!contexto) {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return false;
            contexto = new AC();
            maestro = contexto.createGain();
            maestro.gain.value = 0;
            maestro.connect(contexto.destination);
        }
        if (contexto.state === "suspended") {
            contexto.resume();
        }
        return true;
    }

    // Una nota de piano: dos senos levemente desafinados, filtro suave y
    // envolvente con ataque lento y caída larga.
    function tocarNota() {
        if (!reproduciendo || !contexto) return;

        const ahora = contexto.currentTime;
        const frecuencia = NOTAS[Math.floor(Math.random() * NOTAS.length)];

        const ganancia = contexto.createGain();
        const filtro = contexto.createBiquadFilter();
        filtro.type = "lowpass";
        filtro.frequency.value = 2200;

        const fundamental = contexto.createOscillator();
        fundamental.type = "sine";
        fundamental.frequency.value = frecuencia;

        const armonico = contexto.createOscillator();
        armonico.type = "sine";
        armonico.frequency.value = frecuencia * 2.003;
        const nivelArmonico = contexto.createGain();
        nivelArmonico.gain.value = 0.12;

        const pico = 0.05 + Math.random() * 0.05;
        ganancia.gain.setValueAtTime(0.0001, ahora);
        ganancia.gain.exponentialRampToValueAtTime(pico, ahora + 0.4);
        ganancia.gain.exponentialRampToValueAtTime(0.0001, ahora + 4.5);

        fundamental.connect(ganancia);
        armonico.connect(nivelArmonico);
        nivelArmonico.connect(ganancia);
        ganancia.connect(filtro);
        filtro.connect(maestro);

        fundamental.start(ahora);
        armonico.start(ahora);
        fundamental.stop(ahora + 5);
        armonico.stop(ahora + 5);

        temporizador = window.setTimeout(tocarNota, 900 + Math.random() * 2200);
    }

    function preparar() {
        asegurarContexto();
    }

    function iniciar() {
        if (!asegurarContexto()) return;
        if (reproduciendo) return;
        reproduciendo = true;

        const ahora = contexto.currentTime;
        maestro.gain.cancelScheduledValues(ahora);
        maestro.gain.setValueAtTime(maestro.gain.value || 0, ahora);
        maestro.gain.linearRampToValueAtTime(VOLUMEN, ahora + 2);

        tocarNota();
    }

    function detener() {
        if (!reproduciendo) return;
        reproduciendo = false;

        if (temporizador !== null) {
            window.clearTimeout(temporizador);
            temporizador = null;
        }

        if (contexto && maestro) {
            const ahora = contexto.currentTime;
            maestro.gain.cancelScheduledValues(ahora);
            maestro.gain.setValueAtTime(maestro.gain.value, ahora);
            maestro.gain.linearRampToValueAtTime(0.0001, ahora + 1.2);
        }
    }

    return { preparar, iniciar, detener };
})();
