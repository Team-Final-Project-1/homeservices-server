const generateUsername = (email) => {
  const base = email
    .split("@")[0]
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  const random = Math.floor(1000 + Math.random() * 9000); // 4 หลัก
  return `${base}${random}`; // เช่น "piyapat4823"
};

export default generateUsername;
