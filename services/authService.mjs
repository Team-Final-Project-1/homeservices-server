import { createClient } from "@supabase/supabase-js";
import pool from "../utils/db.mjs";


// *************โค้ดเก่าพี่จั้มอย่าพึ่งลบ เพราะอาจจะต้องใช้ในการ debug*************

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