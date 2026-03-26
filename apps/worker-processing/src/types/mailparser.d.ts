declare module 'mailparser' {
  export interface MailAddress {
    name?: string;
    address?: string;
  }

  export interface AddressObject {
    value: MailAddress[];
    text?: string;
  }

  export interface Attachment {
    filename?: string | null;
    contentType: string;
    content: Buffer;
  }

  export interface ParsedMail {
    subject?: string;
    text?: string;
    html?: string | false;
    from?: AddressObject;
    to?: AddressObject;
    cc?: AddressObject;
    bcc?: AddressObject;
    messageId?: string;
    inReplyTo?: string | string[];
    references?: string | string[];
    date?: Date;
    attachments: Attachment[];
  }

  export function simpleParser(source: Buffer | string): Promise<ParsedMail>;
}
