export class MessageService {
  constructor({ MessageModel }) {
    this.Message = MessageModel;
  }

  async createUserMessage(threadId, content) {
    if (content?.trim()) {
      await this.Message.create({ threadId, role: 'user', content });
    }
  }

  async createAssistantMessage(threadId, content) {
    if (content?.trim()) {
      await this.Message.create({ threadId, role: 'assistant', content });
    }
  }
}

