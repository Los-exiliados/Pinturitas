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
//   - tormenta(intensidad): nivel de lluvia (0 a 1) para las obras con
//     tormenta.
//   - trueno(): dispara el sonido de un trueno.

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

    // --- Tormenta: lluvia continua y truenos ------------------------------

    let gananciaLluvia = null;

    function crearBufferRuido(segundos) {
        const buffer = contexto.createBuffer(
            1,
            Math.floor(contexto.sampleRate * segundos),
            contexto.sampleRate
        );
        const datos = buffer.getChannelData(0);
        for (let i = 0; i < datos.length; i += 1) {
            datos[i] = Math.random() * 2 - 1;
        }
        return buffer;
    }

    function asegurarLluvia() {
        if (gananciaLluvia) return;

        const fuente = contexto.createBufferSource();
        fuente.buffer = crearBufferRuido(2);
        fuente.loop = true;

        const filtro = contexto.createBiquadFilter();
        filtro.type = "lowpass";
        filtro.frequency.value = 900;

        gananciaLluvia = contexto.createGain();
        gananciaLluvia.gain.value = 0;

        fuente.connect(filtro);
        filtro.connect(gananciaLluvia);
        gananciaLluvia.connect(maestro);
        fuente.start();
    }

    // Nivel de lluvia según la intensidad de la tormenta (0 a 1).
    function tormenta(intensidad) {
        if (!asegurarContexto()) return;
        asegurarLluvia();
        const objetivo = Math.max(0, Math.min(1, intensidad)) * 0.35;
        gananciaLluvia.gain.setTargetAtTime(objetivo, contexto.currentTime, 0.4);
    }

    // Trueno: ráfaga de ruido grave con caída larga.
    function trueno() {
        if (!asegurarContexto()) return;
        const ahora = contexto.currentTime;

        const fuente = contexto.createBufferSource();
        fuente.buffer = crearBufferRuido(2);

        const filtro = contexto.createBiquadFilter();
        filtro.type = "lowpass";
        filtro.frequency.setValueAtTime(420, ahora);
        filtro.frequency.exponentialRampToValueAtTime(70, ahora + 1.4);

        const ganancia = contexto.createGain();
        ganancia.gain.setValueAtTime(0.9, ahora);
        ganancia.gain.exponentialRampToValueAtTime(0.001, ahora + 2);

        fuente.connect(filtro);
        filtro.connect(ganancia);
        ganancia.connect(maestro);

        fuente.start(ahora);
        fuente.stop(ahora + 2.2);
    }

    return { preparar, iniciar, detener, tormenta, trueno };
})();
