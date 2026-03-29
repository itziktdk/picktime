const mongoose = require('mongoose');
const { Schema } = mongoose;

const CustomerSchema = new Schema({
  business: {
    type: Schema.Types.ObjectId,
    ref: 'Business',
    required: true
  },
  personalInfo: {
    firstName: {
      type: String,
      required: true,
      trim: true
    },
    lastName: {
      type: String,
      required: true,
      trim: true
    },
    email: {
      type: String,
      trim: true,
      lowercase: true
    },
    phone: {
      type: String,
      required: true,
      trim: true
    },
    dateOfBirth: Date,
    gender: {
      type: String,
      enum: ['male', 'female', 'other']
    }
  },
  preferences: {
    preferredProvider: {
      type: Schema.Types.ObjectId,
      ref: 'Provider'
    },
    preferredTimes: [{
      day: { type: Number, min: 0, max: 6 },
      timeRanges: [{
        start: String, // "09:00"
        end: String // "12:00"
      }]
    }],
    notifications: {
      email: { type: Boolean, default: true },
      sms: { type: Boolean, default: false },
      whatsapp: { type: Boolean, default: true },
      reminderTime: { type: Number, default: 60 } // minutes before appointment
    },
    language: { type: String, default: 'he' }
  },
  notes: {
    general: String, // General notes about customer
    medical: String, // Medical considerations
    allergies: String, // Allergies or sensitivities
    preferences: String // Service preferences
  },
  history: {
    firstVisit: { type: Date, default: Date.now },
    lastVisit: Date,
    totalAppointments: { type: Number, default: 0 },
    totalSpent: { type: Number, default: 0 },
    averageRating: { type: Number, default: 0 },
    favoriteServices: [{
      service: { type: Schema.Types.ObjectId, ref: 'Service' },
      count: Number
    }]
  },
  loyalty: {
    points: { type: Number, default: 0 },
    tier: { type: String, enum: ['bronze', 'silver', 'gold', 'platinum'], default: 'bronze' },
    discountPercentage: { type: Number, default: 0 }
  },
  marketing: {
    source: String, // How they found the business
    allowMarketing: { type: Boolean, default: true },
    tags: [String] // Marketing tags
  },
  status: {
    type: String,
    enum: ['active', 'inactive', 'blocked'],
    default: 'active'
  },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Update the updatedAt field before saving
CustomerSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Virtual for full name
CustomerSchema.virtual('fullName').get(function() {
  return `${this.personalInfo.firstName} ${this.personalInfo.lastName}`;
});

// Index for efficient searches
CustomerSchema.index({ business: 1, 'personalInfo.phone': 1 });
CustomerSchema.index({ business: 1, 'personalInfo.email': 1 });
CustomerSchema.index({ business: 1, status: 1 });

CustomerSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.model('Customer', CustomerSchema);