import nodemailer from "nodemailer";

export interface Mailer {
  sendLoginCode(to: string, code: string): Promise<void>;
}

export function createSmtpMailer(smtpUrl: string, from: string): Mailer {
  const transport = nodemailer.createTransport(smtpUrl);
  return {
    async sendLoginCode(to, code) {
      await transport.sendMail({
        from,
        to,
        subject: `${code} is your login code`,
        text: `Your login code is ${code}. It expires in 10 minutes.\n\nIf you didn't ask for this, ignore this email.`,
      });
    },
  };
}
