const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

// Basic middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve static files
app.use(express.static('public'));

// In-memory storage
let businesses = [];
let appointments = [];
let services = [];
let counter = 1;

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    service: 'PickTime API',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Get all businesses
app.get('/api/businesses', (req, res) => {
  res.json(businesses);
});

// Create new business
app.post('/api/businesses', (req, res) => {
  const business = {
    id: counter++,
    ...req.body,
    createdAt: new Date().toISOString()
  };
  businesses.push(business);
  res.status(201).json(business);
});

// Get appointments
app.get('/api/appointments', (req, res) => {
  res.json(appointments);
});

// Create appointment
app.post('/api/appointments', (req, res) => {
  const appointment = {
    id: counter++,
    ...req.body,
    status: 'pending',
    createdAt: new Date().toISOString()
  };
  appointments.push(appointment);
  res.status(201).json(appointment);
});

// Serve main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal Server Error' });
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ PickTime Server running on port ${PORT}`);
  console.log(`🌐 Access at: http://localhost:${PORT}`);
});