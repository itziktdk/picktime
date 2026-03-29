const mongoose = require('mongoose');
const { Schema } = mongoose;

const BusinessSchema = new Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  slug: {
    type: String,
    required: true,
    unique: true,
    lowercase: true
  },
  description: {
    type: String,
    trim: true
  },
  category: {
    type: String,
    required: true,
    enum: ['beauty', 'hair', 'fitness', 'tutoring', 'medical', 'tech']
  },
  theme: {
    type: String,
    required: true,
    enum: ['beauty', 'hair', 'fitness', 'tutoring', 'medical', 'tech']
  },
  owner: {
    name: { type: String, required: true },
    email: { type: String, required: true },
    phone: { type: String, required: true }
  },
  contact: {
    phone: { type: String, required: true },
    email: String,
    whatsapp: String,
    address: {
      street: String,
      city: String,
      zipCode: String,
      coordinates: {
        lat: Number,
        lng: Number
      }
    }
  },
  settings: {
    timezone: { type: String, default: 'Asia/Jerusalem' },
    language: { type: String, default: 'he' },
    workingHours: [{
      day: { type: Number, min: 0, max: 6 }, // 0=Sunday, 6=Saturday
      start: String, // "09:00"
      end: String, // "18:00"
      isActive: { type: Boolean, default: true }
    }],
    bookingWindow: {
      minAdvance: { type: Number, default: 1 }, // hours
      maxAdvance: { type: Number, default: 720 } // hours (30 days)
    },
    notifications: {
      email: { type: Boolean, default: true },
      sms: { type: Boolean, default: false },
      whatsapp: { type: Boolean, default: true }
    }
  },
  customization: {
    logo: String, // URL to logo image
    colors: {
      primary: String,
      secondary: String,
      accent: String,
      background: String,
      surface: String,
      text: String
    },
    welcomeMessage: String,
    thankYouMessage: String
  },
  subscription: {
    plan: { type: String, enum: ['free', 'basic', 'premium'], default: 'free' },
    expiresAt: Date,
    features: {
      maxServices: { type: Number, default: 3 },
      maxProviders: { type: Number, default: 1 },
      maxAppointmentsPerMonth: { type: Number, default: 100 },
      analytics: { type: Boolean, default: false },
      customBranding: { type: Boolean, default: false }
    }
  },
  stats: {
    totalAppointments: { type: Number, default: 0 },
    totalCustomers: { type: Number, default: 0 },
    rating: { type: Number, default: 0, min: 0, max: 5 },
    reviewsCount: { type: Number, default: 0 }
  },
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Update the updatedAt field before saving
BusinessSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Generate slug from name if not provided
BusinessSchema.pre('save', function(next) {
  if (!this.slug && this.name) {
    this.slug = this.name
      .toLowerCase()
      .replace(/[^\w\s-]/g, '') // Remove special characters
      .replace(/[\s_-]+/g, '-') // Replace spaces and underscores with hyphens
      .replace(/^-+|-+$/g, ''); // Remove leading/trailing hyphens
  }
  next();
});

// Virtual populate for services and providers
BusinessSchema.virtual('services', {
  ref: 'Service',
  localField: '_id',
  foreignField: 'business'
});

BusinessSchema.virtual('providers', {
  ref: 'Provider', 
  localField: '_id',
  foreignField: 'business'
});

BusinessSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.model('Business', BusinessSchema);