import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Express } from "express";
import session from "express-session";
import bcrypt from "bcrypt";
import { storage } from "./storage";
import type { User } from "@shared/schema";
import connectPg from "connect-pg-simple";
import { pool } from "./db";

declare global {
  namespace Express {
    interface User {
      id: number;
      username: string;
      email: string;
      isAdmin: boolean;
      isEnabled: boolean;
    }
  }
}

const SALT_ROUNDS = 10;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function setupAuth(app: Express) {
  const PgSession = connectPg(session);
  
  const sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret) {
    throw new Error("SESSION_SECRET environment variable is required");
  }
  
  app.use(
    session({
      store: new PgSession({
        pool,
        tableName: "user_sessions",
        createTableIfMissing: true,
      }),
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        // Only enforce Secure flag when explicitly enabled (i.e. running behind HTTPS).
        // Do NOT tie this to NODE_ENV — production servers served over plain HTTP
        // (e.g. behind a local proxy or direct PM2) lose the session cookie on reload.
        secure: process.env.SESSION_SECURE_COOKIE === "true",
        httpOnly: true,
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        sameSite: "lax",
      },
    })
  );

  app.use(passport.initialize());
  app.use(passport.session());

  passport.use(
    new LocalStrategy(
      {
        usernameField: "username",
        passwordField: "password",
      },
      async (username, password, done) => {
        try {
          // Try to find by username or email
          let user = await storage.getUserByUsername(username);
          if (!user) {
            user = await storage.getUserByEmail(username);
          }
          
          if (!user) {
            return done(null, false, { message: "Invalid username or password" });
          }

          // Check if user is disabled
          if (!user.isEnabled) {
            return done(null, false, { message: "Your account has been disabled" });
          }

          const isValid = await comparePassword(password, user.password);
          if (!isValid) {
            return done(null, false, { message: "Invalid username or password" });
          }

          return done(null, {
            id: user.id,
            username: user.username,
            email: user.email,
            isAdmin: user.isAdmin,
            isEnabled: user.isEnabled,
          });
        } catch (error) {
          return done(error);
        }
      }
    )
  );

  passport.serializeUser((user, done) => {
    done(null, user.id);
  });

  passport.deserializeUser(async (id: number, done) => {
    try {
      const user = await storage.getUser(id);
      if (!user) {
        return done(null, false);
      }
      done(null, {
        id: user.id,
        username: user.username,
        email: user.email,
        isAdmin: user.isAdmin,
        isEnabled: user.isEnabled,
      });
    } catch (error) {
      done(error);
    }
  });
}
