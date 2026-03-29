const mongoose = require('mongoose');
const { Schema } = mongoose;

const ProviderSchema = new Schema({
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
      trim: true
    },
    photo: String, // URL to profile photo
    bio: String, // Professional bio
    title: String // Job title/position
  },
  services: [{
    service: { type: Schema.Types.ObjectId, ref: 'Service' },
    proficiencyLevel: { type: String, enum: ['beginner', 'intermediate', 'expert'], default: 'expert' },
    customPrice: Number // Override service price for this provider
  }],
  schedule: {
    workingHours: [{
      day: { type: Number, min: 0, max: 6 }, // 0=Sunday, 6=Saturday
      start: String, // "09:00"
      end: String, // "18:00"
      isActive: { type: Boolean, default: true }
    }],
    breaks: [{
      day: { type: Number, min: 0, max: 6 },
      start: String, // "13:00"
      end: String, // "14:00"
      title: String // "Lunch break"
    }],
    vacations: [{
      start: Date,
      end: Date,
      title: String,
      isRecurring: { type: Boolean, default: false }
    }],
    timeSlotDuration: { type: Number, default: 30 }, // minutes
    bufferTime: { type: Number, default: 0 } // minutes between appointments
  },
  settings: {
    isActive: { type: Boolean, default: true },
    acceptsOnlineBooking: { type: Boolean, default: true },
    requiresApproval: { type: Boolean, default: false }, // Manual approval for bookings
    advanceBookingLimit: { type: Number, default: 720 }, // hours
    cancellationPolicy: {
      allowCustomerCancellation: { type: Boolean, default: true },
      hoursBeforeStart: { type: Number, default: 24 }
    }
  },
  performance: {
    totalAppointments: { type: Number, default: 0 },
    completedAppointments: { type: Number, default: 0 },
    cancelledAppointments: { type: Number, default: 0 },
    noShowAppointments: { type: Number, default: 0 },
    averageRating: { type: Number, default: 0 },
    totalReviews: { type: Number, default: 0 },
    totalRevenue: { type: Number, default: 0 }
  },
  permissions: {
    canViewAllAppointments: { type: Boolean, default: false },
    canEditAppointments: { type: Boolean, default: true },
    canViewCustomerInfo: { type: Boolean, default: true },
    canAccessReports: { type: Boolean, default: false }
  },
  commission: {
    type: { type: String, enum: ['percentage', 'fixed'], default: 'percentage' },
    rate: { type: Number, default: 0 }, // Percentage (0-100) or fixed amount
    minimumPayout: { type: Number, default: 100 }
  },
  authentication: {
    loginCode: String, // Simple PIN for provider login
    lastLogin: Date,
    isOwner: { type: Boolean, default: false } // Business owner
  },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Update the updatedAt field before saving
ProviderSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Virtual for full name
ProviderSchema.virtual('fullName').get(function() {
  return `${this.personalInfo.firstName} ${this.personalInfo.lastName}`;
});

// Virtual for completion rate
ProviderSchema.virtual('completionRate').get(function() {
  if (this.performance.totalAppointments === 0) return 0;
  return (this.performance.completedAppointments / this.performance.totalAppointments) * 100;
});

// Index for efficient queries
ProviderSchema.index({ business: 1, 'settings.isActive': 1 });
ProviderSchema.index({ business: 1, 'services.service': 1 });

ProviderSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.model('Provider', ProviderSchema);