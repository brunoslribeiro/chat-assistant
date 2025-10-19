import { v4 as uuidv4 } from 'uuid';

export class DecisionService {
  constructor({ DecisionModel }) {
    this.Decision = DecisionModel;
  }

  async saveDecision(threadId, openaiThreadId, decision) {
    if (!decision) return;
    await this.Decision.create({ _id: uuidv4(), threadId, openaiThreadId, decision });
  }
}

