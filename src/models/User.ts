import mongoose, { Schema, type HydratedDocument, type Model } from 'mongoose';

export const USER_STATUSES = ['active', 'disabled'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export interface IUser {
  email: string;
  passwordHash: string;
  name?: string;
  status: UserStatus;
  /** Embedded in every JWT; bumping it invalidates all previously issued tokens. */
  tokenVersion: number;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUser>(
  {
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 254,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'invalid email'],
    },
    // select:false → never returned unless a query explicitly asks for it.
    passwordHash: { type: String, required: true, select: false },
    name: { type: String, trim: true, maxlength: 100 },
    status: { type: String, enum: USER_STATUSES, default: 'active', required: true },
    tokenVersion: { type: Number, default: 0, min: 0 },
    lastLoginAt: { type: Date },
  },
  { collection: 'users', timestamps: true },
);

UserSchema.index({ email: 1 }, { unique: true });

export type UserDoc = HydratedDocument<IUser>;

export const UserModel: Model<IUser> =
  (mongoose.models.User as Model<IUser> | undefined) ?? mongoose.model<IUser>('User', UserSchema);
