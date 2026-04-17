import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';

const allowedEmails = (process.env.ALLOWED_EMAILS || '').split(',').map(e => e.trim()).filter(Boolean);

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
    }),
  ],
  callbacks: {
    async signIn({ user }) {
      if (allowedEmails.length === 0) return true;
      const email = (user.email || '').toLowerCase();
      return allowedEmails.some(allowed => {
        const a = allowed.toLowerCase();
        return a.startsWith('@') ? email.endsWith(a) : email === a;
      });
    },
    async session({ session }) {
      return session;
    },
  },
  pages: {
    signIn: '/login',
  },
});
