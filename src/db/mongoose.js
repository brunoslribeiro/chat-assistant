import mongoose from 'mongoose';

export async function connectMongo(uri) {
  await mongoose.connect(uri, { autoIndex: true });
  return mongoose;
}

export { mongoose };

