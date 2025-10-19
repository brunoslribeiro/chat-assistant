import { createParser as createSSEParserLib } from 'eventsource-parser';

/**
 * SSEService: inicialização e parsing de Server-Sent Events.
 * Abstrai detalhes de protocolo e expõe uma interface simples para o restante da aplicação.
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

  /** Cria um parser baseado em eventsource-parser e retorna um handler de chunks */
  createParser(onEvent) {
    const parser = createSSEParserLib(async (evt) => {
      if (evt.type !== 'event') return;
      const name = (evt.event && evt.event.trim()) || 'message';
      const dataStr = evt.data ?? '';
      if (dataStr === '') return;
      let payload;
      try { payload = JSON.parse(dataStr); } catch { payload = { raw: dataStr }; }
      await onEvent(name, payload);
    });
    return {
      onChunk: (chunk) => parser.feed(typeof chunk === 'string' ? chunk : chunk.toString('utf8'))
    };
  }

  /**
   * Faz o wire do stream da OpenAI, parseando e repassando eventos.
   * onEvent(eventName, payload), onCompleted(), onError(err)
   */
  wire({ stream, onEvent, onCompleted, onError }) {
    stream.setEncoding('utf8');
    const parser = this.createParser(onEvent);
    stream.on('data', parser.onChunk);
    stream.on('end', () => onCompleted && onCompleted());
    stream.on('error', (err) => onError && onError(err));
  }
}
