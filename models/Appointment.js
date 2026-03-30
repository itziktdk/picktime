const mongoose = require('mongoose');
const { Schema } = mongoose;

const AppointmentSchema = new Schema({
  business: {
    type: Schema.Types.ObjectId,
    ref: 'Business',
    required: true
  },
  customer: {
    type: Schema.Types.ObjectId,
    ref: 'Customer',
    required: true
  },
  service: {
    type: Schema.Types.ObjectId,
    ref: 'Service',
    required: true
  },
  provider: {
    type: Schema.Types.ObjectId,
    ref: 'Provider',
    required: true
  },
  scheduling: {
    dateTime: {
      type: Date,
      required: true
    },
    duration: {
      type: Number, // in minutes
      required: true
    },
    endTime: {
      type: Date,
      required: true
    },
    timezone: {
      type: String,
      default: 'Asia/Jerusalem'
    }
  },
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'in-progress', 'completed', 'cancelled', 'no-show'],
    default: 'pending'
  },
  payment: {
    total: {
      amount: { type: Number, required: true },
      currency: { type: String, default: 'ILS' }
    },
    deposit: {
      amount: Number,
      paid: { type: Boolean, default: false },
      paidAt: Date,
      method: String
    },
    final: {
      amount: Number,
      paid: { type: Boolean, default: false },
      paidAt: Date,
      method: String
    },
    refund: {
      amount: Number,
      refundedAt: Date,
      reason: String
    }
  },
  communication: {
    confirmationSent: { type: Boolean, default: false },
    remindersSent: [{ 
      sentAt: Date, 
      type: String, // 'email', 'sms', 'whatsapp'
      hours: Number // hours before appointment
    }],
    customerNotes: String, // Notes from customer when booking
    businessNotes: String // Internal notes for the business
  },
  waitingList: {
    isWaitingList: { type: Boolean, default: false },
    originalSlot: Date, // The slot they originally wanted
    priority: { type: Number, default: 0 } // Higher number = higher priority
  },
  changes: [{
    type: { type: String, enum: ['reschedule', 'cancel', 'modify'] },
    previousValue: Schema.Types.Mixed,
    newValue: Schema.Types.Mixed,
    changedBy: String, // 'customer' or 'business'
    changedAt: { type: Date, default: Date.now },
    reason: String
  }],
  review: {
    rating: { type: Number, min: 1, max: 5 },
    comment: String,
    submittedAt: Date,
    response: String, // Business response to review
    respondedAt: Date
  },
  metadata: {
    source: String, // 'web', 'mobile', 'phone', 'walkin'
    ipAddress: String,
    userAgent: String,
    referrer: String
  },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Calculate end time before saving
AppointmentSchema.pre('save', function(next) {
  if (this.scheduling.dateTime && this.scheduling.duration) {
    this.scheduling.endTime = new Date(
      this.scheduling.dateTime.getTime() + (this.scheduling.duration * 60000)
    );
  }
  this.updatedAt = Date.now();
  next();
});

// Index for efficient queries
AppointmentSchema.index({ business: 1, 'scheduling.dateTime': 1 });
AppointmentSchema.index({ customer: 1, status: 1 });
AppointmentSchema.index({ provider: 1, 'scheduling.dateTime': 1 });
AppointmentSchema.index({ business: 1, status: 1, 'scheduling.dateTime': 1 });

// Virtual for appointment duration display
AppointmentSchema.virtual('durationFormatted').get(function() {
  const hours = Math.floor(this.scheduling.duration / 60);
  const minutes = this.scheduling.duration % 60;
  if (hours > 0) {
    return minutes > 0 ? `${hours}:${minutes.toString().padStart(2, '0')} שעות` : `${hours} שעות`;
  }
  return `${minutes} דקות`;
});

AppointmentSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.model('Appointment', AppointmentSchema);