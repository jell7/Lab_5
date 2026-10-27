export function validateMessage(rawData) {
  try {
    const data = JSON.parse(rawData);
    if (!data || typeof data.type !== 'string') return null;
    return data;
  } catch (e) {
    return null; 
  }
}