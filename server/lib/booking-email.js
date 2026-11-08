const config = require('../config');

function emailDetails(reservation) {
  const date = reservation.checkIn === reservation.checkOut
    ? reservation.checkIn
    : `${reservation.checkIn} to ${reservation.checkOut}`;
  const duration = reservation.durationMinutes
    ? `${reservation.durationMinutes / 60} hours`
    : `${reservation.nights} night(s)`;
  return {
    reference: reservation.reference,
    service: reservation.roomName,
    date,
    startTime: reservation.preferredTime || '—',
    endTime: reservation.checkOutTime || '—',
    duration,
    total: new Intl.NumberFormat('en-PH', {
      style: 'currency',
      currency: config.currency,
    }).format(reservation.total),
  };
}

module.exports = { emailDetails };
