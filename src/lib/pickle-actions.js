import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const PYTHON_DECODER = String.raw`
import binascii, io, json, os, pickle

class Dummy:
    def __init__(self, *args, **kwargs):
        pass

    def __setstate__(self, state):
        if isinstance(state, dict):
            self.__dict__.update(state)
        else:
            self.__dict__['state'] = state

class SafeUnpickler(pickle.Unpickler):
    def find_class(self, module, name):
        return Dummy

def normalize(value):
    if isinstance(value, Dummy):
        data = dict(value.__dict__)
        if '__dict__' in data and isinstance(data['__dict__'], dict) and len(data) == 4:
            return normalize(data['__dict__'])
        data['__class__'] = 'Dummy'
        return {key: normalize(val) for key, val in data.items()}
    if isinstance(value, dict):
        return {str(key): normalize(val) for key, val in value.items()}
    if isinstance(value, (list, tuple)):
        return [normalize(item) for item in value]
    if isinstance(value, set):
        return sorted([normalize(item) for item in value], key=lambda item: json.dumps(item, sort_keys=True, ensure_ascii=False))
    if isinstance(value, bytes):
        return {'__type__': 'bytes', 'hex': value.hex()}
    return value

hex_value = os.environ['ACTIONS_HEX']
data = binascii.unhexlify(hex_value)
obj = SafeUnpickler(io.BytesIO(data)).load()
print(json.dumps(normalize(obj), ensure_ascii=False))
`;

export async function decodePickleActionsHex(actionsHex) {
  if (typeof actionsHex !== 'string' || !actionsHex.trim()) {
    return null;
  }

  const { stdout } = await execFileAsync('python3', ['-c', PYTHON_DECODER], {
    env: {
      ...process.env,
      ACTIONS_HEX: actionsHex.trim(),
    },
    maxBuffer: 2 * 1024 * 1024,
  });

  return JSON.parse(stdout);
}
