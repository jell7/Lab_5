import { validateInputMessage } from 'shared/protocol';
import { decodeBinaryInput } from 'shared/codec';

export function validateMessage(rawData, isBinary = false) {
  try {
    if (isBinary) {
      const decoded = decodeBinaryInput(rawData);
      if (!decoded) return null;
      return validateInputMessage(decoded);
    }

    const text = typeof rawData === 'string' ? rawData : rawData.toString('utf8');
    const data = JSON.parse(text);
    if (!data || typeof data.type !== 'string') return null;

    if (data.type === 'input') {
      return validateInputMessage(data);
    }

    return data;
  } catch {
    return null;
  }
}