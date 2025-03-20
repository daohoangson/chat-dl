import type { Message } from "./models";

export function renderFromMessages(messages: Message[]): string {
  const markdown = [];

  for (const message of messages) {
    const sender = message.sender === "human" ? "Human" : "Claude";
    markdown.push(`# ${sender}`);

    // Combine all text content from message parts
    const messageText = message.content
      .filter(part => part.type === "text")
      .map(part => part.text)
      .join("\n\n");
    
    markdown.push(messageText);
  }

  return markdown.join("\n\n");
}