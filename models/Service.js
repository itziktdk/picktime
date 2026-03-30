const mongoose = require('mongoose');
const { Schema } = mongoose;

const ServiceSchema = new Schema({
  business: {
    type: Schema.Types.ObjectId,
    ref: 'Business',
    required: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  duration: {
    type: Number, // in minutes
    required: true,
    min: 5,
    max: 480 // 8 hours max
  },
  price: {
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'ILS' }
  },
  category: {
    type: String,
    required: true
  },
  providers: [{
    type: Schema.Types.ObjectId,
    ref: 'Provider'
  }], // Who can provide this service
  requirements: {
    gender: { type: String, enum: ['any', 'male', 'female'], default: 'any' },
    ageMin: Number,
    ageMax: Number,
    notes: String
  },
  availability: {
    days: [{ type: Number, min: 0, max: 6 }], // Days of week available
    timeSlots: [{
      start: String, // "09:00"
      end: String, // "17:00"
    }]
  },
  booking: {
    isOnline: { type: Boolean, default: true },
    requiresDeposit: { type: Boolean, default: false },
    depositAmount: Number,
    cancellationPolicy: {
      allowCancellation: { type: Boolean, default: true },
      hoursBeforeStart: { type: Number, default: 24 },
      refundPolicy: String
    }
  },
  customization: {
    color: String, // Service specific color
    icon: String, // Heroicons icon name
    image: String // Service image URL
  },
  stats: {
    totalBookings: { type: Number, default: 0 },
    rating: { type: Number, default: 0, min: 0, max: 5 },
    reviewsCount: { type: Number, default: 0 }
  },
  isActive: { type: Boolean, default: true },
  order: { type: Number, default: 0 }, // For sorting services
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Update the updatedAt field before saving
ServiceSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Index for efficient queries
ServiceSchema.index({ business: 1, isActive: 1 });
ServiceSchema.index({ business: 1, category: 1 });

module.exports = mongoose.model('Service', ServiceSchema);