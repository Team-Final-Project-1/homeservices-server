import pool from "../utils/db.mjs";

const technicianProfileServices = {
  getTechnicianProfile: async (technicianId) => {
    const profileResult = await pool.query(
      `
        SELECT u.id,
        u.first_name,
        u.last_name,
        u.phone,
        up.is_available,
        up.latitude,
        up.longitude,
        up.location_updated_at
        FROM users u
        LEFT JOIN user_profiles up ON u.id = up.user_id
        WHERE u.id = $1 AND u.role = 'technician'
    `,
      [technicianId],
    );

    if (profileResult.rows.length === 0) {
      return null;
    }
    const technicianData = profileResult.rows[0];

    const servicesResult = await pool.query(
      `SELECT 
        s.id, 
        s.name, 
        CASE 
            WHEN ts.technician_id IS NOT NULL THEN true 
            ELSE false 
        END AS is_selected
        FROM services s
        LEFT JOIN technician_services ts 
        ON s.id = ts.service_id AND ts.technician_id = $1 
        ORDER BY s.id
        `,
      [technicianId],
    );

    return {
      ...technicianData,
      services: servicesResult.rows,
    };
  },
  updateTechnicianProfile: async (technicianId, data) => {
    const {
      first_name,
      last_name,
      phone,
      is_available,
      latitude,
      longitude,
      service_ids,
    } = data;

    await pool.query(
      `UPDATE users
        SET first_name = $1,
            last_name = $2,
            full_name = $1 || ' ' || $2,
            phone = $3,
            updated_at = NOW()
        WHERE id = $4 AND role = 'technician'`,
      [first_name, last_name, phone, technicianId],
    );

    await pool.query(
      `INSERT INTO user_profiles (user_id, is_available, latitude, longitude, location_updated_at)
        VALUES ($4, $1, $2::numeric, $3::numeric, CASE WHEN $2 IS NOT NULL THEN NOW() ELSE NULL END)
        ON CONFLICT (user_id) DO UPDATE
        SET
        is_available = EXCLUDED.is_available,
        latitude = EXCLUDED.latitude,
        longitude = EXCLUDED.longitude,
        location_updated_at = CASE
       WHEN EXCLUDED.latitude IS NOT NULL THEN NOW()
       ELSE user_profiles.location_updated_at
     END,
     updated_at = NOW()`,
      [is_available, latitude ?? null, longitude ?? null, technicianId],
    );

    await pool.query(
      `DELETE FROM technician_services WHERE technician_id = $1`,
      [technicianId],
    );

    if (service_ids && service_ids.length > 0) {
      const placeholders = service_ids
        .map((_, index) => `($1, $${index + 2})`)
        .join(", ");

      await pool.query(
        `INSERT INTO technician_services (technician_id, service_id) VALUES ${placeholders}`,
        [technicianId, ...service_ids],
      );
    }
    return technicianProfileServices.getTechnicianProfile(technicianId);
  },
};

export default technicianProfileServices;
