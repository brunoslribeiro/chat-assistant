/**
 * SSEService: inicialização e parsing de Server-Sent Events.
 * Implementação manual com buffer para menor overhead, mantendo
 * processamento sequencial para evitar condições de corrida.
 */
export class SSEService {
  /** Inicializa os headers de SSE na resposta Express */
  init(res) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof res.flushHeaders === 'function') res.flushHeaders();
  }

  /** Envia um evento SSE com nome e payload JSON */
  send(res, event, payload) {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  }

  /** Cria um parser SSE manual baseado em buffer e duplo newline */
  createParser(onEvent) {
    let buffer = '';
    return {
      onChunk: async (chunk) => {
        buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
        let idx;
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const rawEvent = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const lines = rawEvent.split('\n');
          let evt = 'message';
          let dataStr = '';
          for (const line of lines) {
            if (line.startsWith('event:')) evt = line.slice(6).trim();
            else if (line.startsWith('data:')) dataStr += line.slice(5).trim();
          }
          if (!dataStr) continue;
          let payload;
          try { payload = JSON.parse(dataStr); } catch { payload = { raw: dataStr }; }
          await onEvent(evt, payload);
        }
      }
    };
  }

  /**
   * Faz o wire do stream da OpenAI, parseando e repassando eventos.
   * onEvent(eventName, payload), onCompleted(), onError(err)
   */
  wire({ stream, onEvent, onCompleted, onError }) {
    stream.setEncoding('utf8');
    let processing = Promise.resolve();
    const seqOnEvent = (evt, payload) => {
      processing = processing.then(() => onEvent(evt, payload));
      return processing;
    };
    const parser = this.createParser(seqOnEvent);
    stream.on('data', parser.onChunk);
    stream.on('end', async () => {
      try { await processing; } catch {}
      onCompleted && onCompleted();
    });
    stream.on('error', (err) => onError && onError(err));
  }
}
