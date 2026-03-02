import { createClient } from "@supabase/supabase-js";
import connectionPool from "../utils/db.mjs";

let supabase;

// =======================================================
// CREATE SUPABASE CLIENT (singleton)
// =======================================================

const getSupabase = () => {
  if (!supabase) {
    supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
  }
  return supabase;
};

// =======================================================
// REGISTER USER
// =======================================================

export const registerUser = async (req, res) => {
  try {

    const { email, password, username, phone } = req.body;

    const supabase = getSupabase();

    const { data, error } =
      await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    const userId = data.user.id;

    await connectionPool.query(
      `
      INSERT INTO users (id, username, phone)
      VALUES ($1,$2,$3)
      `,
      [userId, username, phone]
    );

    res.status(201).json({
      message: "Register success",
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Register failed" });
  }
};

// =======================================================
// GOOGLE OAUTH
// =======================================================

export const googleOAuth = async (req, res) => {
  try {

    const supabase = getSupabase();

    const { data, error } =
      await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: process.env.OAUTH_REDIRECT_URL,
        },
      });

    if (error) {
      return res.status(500).json(error);
    }

    return res.redirect(data.url);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "OAuth failed" });
  }
};

// =======================================================
// FACEBOOK OAUTH
// =======================================================

export const facebookOAuth = async (req, res) => {
  try {

    const supabase = getSupabase();

    const { data, error } =
      await supabase.auth.signInWithOAuth({
        provider: "facebook",
        options: {
          redirectTo: process.env.OAUTH_REDIRECT_URL,
        },
      });

    if (error) {
      return res.status(500).json(error);
    }

    return res.redirect(data.url);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "OAuth failed" });
  }
};