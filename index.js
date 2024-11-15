const express = require('express');
const app = express();
const { Pool } = require('pg')
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const port = process.env.PORT || 3000;
const crypto = require('crypto');



const pool = new Pool({
  connectionString: "postgres://default:60tfIjAVpXql@ep-white-dream-a44cw6ox-pooler.us-east-1.aws.neon.tech:5432/verceldb?sslmode=require"
})


/*

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'db',
  password: 'developer@100',
  port: 5432
});


*/
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

app.use(express.json()); // Parse JSON bodies
app.use(express.urlencoded({ extended: true }));

const sendMailMessage = async (body,receiver,subject) => {
  console.log('sending mail');

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: 'anoibidickson@gmail.com',
      pass: 'rgxdeqwdxcydsipg', // Your App Password
    },
  });

  const mailOptions = {
    from: 'YASSER APP(DEMO) <anoibidickson@gmail.com>',
    to: receiver,
    subject: subject,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body {
            font-family: Arial, sans-serif;
            margin: 0;
            padding: 0;
            background-color: #f4f4f4;
          }
          .container {
            width: 100%;
            padding: 20px;
            max-width: 600px;
            margin: auto;
            background-color: #ffffff;
            box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
          }
          .header {
            background-color: #4CAF50;
            padding: 10px;
            color: #ffffff;
            text-align: center;
            font-size: 24px;
          }
          .otp {
            font-size: 36px;
            font-weight: bold;
            color: #333333;
            text-align: center;
            margin: 20px 0;
          }
          .message {
            font-size: 16px;
            color: #555555;
            line-height: 1.6;
            text-align: center;
            padding: 0 20px;
          }
          .footer {
            text-align: center;
            font-size: 14px;
            color: #999999;
            padding: 10px;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">${subject}</div>
          <p class="message">${body}</p>
          <div class="footer">Thank you for choosing our service!</div>
        </div>
      </body>
      </html>
    `,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('Email sent:', info.response);
  } catch (error) {
    console.log('Error:', error);
  }
};


const sendMail = async (otp,receiver,subject) => {
  console.log('sending mail');

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: 'anoibidickson@gmail.com',
      pass: 'rgxdeqwdxcydsipg', // Your App Password
    },
  });

  const mailOptions = {
    from: 'YASSER APP(DEMO) <anoibidickson@gmail.com>',
    to: receiver,
    subject: subject,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body {
            font-family: Arial, sans-serif;
            margin: 0;
            padding: 0;
            background-color: #f4f4f4;
          }
          .container {
            width: 100%;
            padding: 20px;
            max-width: 600px;
            margin: auto;
            background-color: #ffffff;
            box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
          }
          .header {
            background-color: #4CAF50;
            padding: 10px;
            color: #ffffff;
            text-align: center;
            font-size: 24px;
          }
          .otp {
            font-size: 36px;
            font-weight: bold;
            color: #333333;
            text-align: center;
            margin: 20px 0;
          }
          .message {
            font-size: 16px;
            color: #555555;
            line-height: 1.6;
            text-align: center;
            padding: 0 20px;
          }
          .footer {
            text-align: center;
            font-size: 14px;
            color: #999999;
            padding: 10px;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">${subject}</div>
          <p class="message">Use the code below to complete your verification process. This code will expire in 10 minutes.</p>
          <div class="otp">${otp}</div>
          <p class="message">If you did not request this, please ignore this email or contact support.</p>
          <div class="footer">Thank you for choosing our service!</div>
        </div>
      </body>
      </html>
    `,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('Email sent:', info.response);
  } catch (error) {
    console.log('Error:', error);
  }
};

// Usage: sendMail with an example OTP


app.get('/', (req, res) => {
  res.send('Yasser APP API');
  
});


app.post('/driver/get-status', async (req, res) => {
  try {
    const { id } = req.body;
    console.log('getting driver availability status')
    // Validate input
    if (!id) {
      return res.status(400).json({ message: 'Driver ID is required', status: false });
    }

    // Get driver status
    const getStatusQuery = {
      text: `SELECT active_status FROM drivers WHERE id = $1`,
      values: [id],
    };

    const result = await pool.query(getStatusQuery);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Driver not found', status: false });
    }

    const driverStatus = result.rows[0].active_status;
    res.status(200).json({ message: 'Driver status retrieved successfully', status: true, active_status: driverStatus });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Internal Server Error', status: false });
  }
});

app.post('/driver/update-status', async (req, res) => {
  try {
    const { id } = req.body;

    console.log('update driver status request', req.body)
    // Validate input
    if (!id) {
      return res.status(400).json({ message: 'Driver ID is required', status: false });
    }

    // Get current active_status
    const getCurrentStatusQuery = {
      text: `SELECT active_status FROM drivers WHERE id = $1`,
      values: [id],
    };

    const result = await pool.query(getCurrentStatusQuery);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Driver not found', status: false });
    }

    const currentStatus = result.rows[0].active_status;
    const newStatus = currentStatus == 1 ? 0 : 1;

    // Update active_status
    const updateQuery = {
      text: `UPDATE drivers SET active_status = $1 WHERE id = $2 RETURNING *`,
      values: [newStatus, id],
    };

    const updatedDriver = await pool.query(updateQuery);

    console.log(`Driver updated: ${updatedDriver.rows[0]}`);
    res.status(200).json({ message: 'Status updated successfully!', status: true, driverstatus: newStatus });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Internal Server Error', status: false });
  }
});

app.post('/driver/register', async (req, res) => {
  try {


    console.log('req data', req.body)

   

    const { name, email, password, phone, country, account_balance, latitude, longitude, verified } = req.body;

    // Check if user exists
    const existingUser = await pool.query(
      'SELECT * FROM drivers WHERE email = $1 OR phone = $2',
      [email, phone]
    );

    if (existingUser.rows.length > 0) {
      return res.status(409).json({ message: 'User already exists', status: false });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create new user

    try {
      const otpCode = Math.floor(1000 + Math.random() * 9000).toString();

      sendMail(otpCode, email,'Yasser - (OTP) for Verification');


      // Insert OTP into otp table
      await pool.query(
        'INSERT INTO verification (email, otp_code) VALUES ($1, $2)',
        [email, otpCode]
      );
    } catch (err) {
      console.error('Error inserting OTP:', err);
      // Handle the error, e.g., rollback the user creation
    }

    const active_status = false

    const newUser = await pool.query(
      'INSERT INTO drivers (name, phone, country, account_balance, email, password, latitude, longitude, verified, active_status, rating, customers, years_of_experience) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 0, 0, 0) RETURNING *',
      [name, phone, country, account_balance, email, hashedPassword, latitude, longitude, verified, active_status]
    );




    console.log(`User inserted: ${newUser.rows[0]}`);
    res.status(200).json({ message: 'Account created successfully!', userId: newUser.rows[0].id, status: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Internal Server Error', status: false });
  }
});

app.get('/users/:id/update-position', async (req, res) => {
  try {
    const { id } = req.params;
    const { latitude, longitude } = req.query;
    await pool.query('UPDATE users SET latitude = $1, longitude = $2 WHERE id = $3', [latitude, longitude, id]);
    res.json({ message: 'User location updated successfully!' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});



app.post('/update-geolocation', async (req, res) => {
  try {

    console.log('request body', req.body)
    const { id, latitude, longitude } = req.body;
    await pool.query(
      'UPDATE users SET latitude = $1, longitude = $2  WHERE id = $3',
      [latitude, longitude, id]
    );
    res.status(200).json({ message: 'Geolocation updated!', status: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal Server Error', status: false });
  }
});

app.post('/users/:id/update-bio', async (req, res) => {
  try {

    console.log('request body', req.body)
    const { id, name, email, phone, countryName } = req.body;
    await pool.query(
      'UPDATE users SET name = $1, email = $2, phone = $3, country = $4  WHERE id = $5',
      [name, email, phone, countryName, id]
    );
    res.json({ message: 'Account informations updated!', status: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal Server Error', status: false });
  }
});

app.post('/register', async (req, res) => {
  try {


    console.log('req data', req.body)

    const { name, email, password, phone, country, account_balance, latitude, longitude, verified } = req.body;

    // Check if user exists
    const existingUser = await pool.query(
      'SELECT * FROM users WHERE email = $1 OR phone = $2',
      [email, phone]
    );

    if (existingUser.rows.length > 0) {
      return res.status(409).json({ message: 'User already exists', status: false });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create new user

    try {
      const otpCode = Math.floor(1000 + Math.random() * 9000).toString();
      sendMail(otpCode, email);

      // Insert OTP into otp table
      await pool.query(
        'INSERT INTO verification (email, otp_code) VALUES ($1, $2)',
        [email, otpCode]
      );
    } catch (err) {
      console.error('Error inserting OTP:', err);
      // Handle the error, e.g., rollback the user creation
    }

    const newUser = await pool.query(
      'INSERT INTO users (name, phone, country, account_balance, email, password, latitude, longitude, verified) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *',
      [name, phone, country, account_balance, email, hashedPassword, latitude, longitude, verified]
    );




    console.log(`User inserted: ${newUser.rows[0]}`);
    res.status(200).json({ message: 'User created successfully!', userId: newUser.rows[0].id, status: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Internal Server Error', status: false });
  }
});

app.post('/transactions', async (req, res) => {
  try {


    console.log('req', req.body)

    const { id } = req.body;

    // Check if user exists
    const history = await pool.query(
      'SELECT * FROM transactions WHERE user_id = $1',
      [id]
    );

    if (history.rows.length > 0) {
      return res.status(200).json({ data: history.rows, status: true });
    }


  } catch (err) {
    return res.status(501).json({ status: false });
  }
});



app.post('/change-password', async (req, res) => {
  try {
    const { id, currentPassword, newPassword } = req.body;

    console.log('request body', req.body)

    // Check if user exists
    const existingUser = await pool.query(
      'SELECT * FROM users WHERE id = $1',
      [id]
    );

    if (existingUser.rows.length === 0) {
      return res.status(404).json({ message: 'Authentication failed', status: false });
    }

    const user = existingUser.rows[0];

    // Check if current password is correct
    console.log('user current hashed password', user.password)
    console.log('user current alias password', currentPassword)

    const isValidPassword = await bcrypt.compare(currentPassword, user.password);

    if (!isValidPassword) {
      return res.status(401).json({ message: 'Invalid current password', status: false });
    }

    // Hash new password
    const hashedNewPassword = await bcrypt.hash(newPassword, 10);

    // Update user password
    await pool.query(
      'UPDATE users SET password = $1 WHERE id = $2',
      [hashedNewPassword, id]
    );

    res.status(200).json({ message: 'Password updated!', status: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Internal Server Error', status: false });
  }
});


app.post('/submit-review', async (req, res) => {
  try {
    const { driverid, description, reviewername, rating, userId } = req.body;

    // Validate input data
    if (!driverid || !description || !reviewername || !rating) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    // Insert review into database
    const result = await pool.query(
      `INSERT INTO driver_reviews (user_id, driver_id, review, rating, reviewerName)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [userId, driverid, description, rating, reviewername]
    );

    // Check if insert was successful
    if (result.rows.length === 0) {
      throw new Error('Failed to insert review');
    }

    res.status(201).json({
      message: 'Review submitted successfully',
      review: result.rows[0],
      status: true
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal Server Error' ,status:false});
  }
});


app.post('/fetch-drivers', async (req, res) => {
  try {
    const {
      pickupLatitude,
      pickupLongitude,
      destinationLatitude,
      destinationLongitude,
      radius = 10,
    } = req.body;

    console.log('request body', req.body);

    if (!pickupLatitude || !pickupLongitude || !destinationLatitude || !destinationLongitude) {
      return res.status(400).json({
        message: 'Pickup and destination coordinates are required',
        status: false,
      });
    }

    const activeDrivers = await pool.query(
      `SELECT *,
        (6371 * acos(sin($1 * PI() / 180) * sin(latitude::double precision * PI() / 180) +
        cos($1 * PI() / 180) * cos(latitude::double precision * PI() / 180) *
        cos(($2 * PI() / 180) - (longitude::double precision * PI() / 180)))) AS distance
      FROM drivers
      WHERE active_status = 'true'
      ORDER BY id DESC`,
      [pickupLatitude, pickupLongitude]
    );

    if (activeDrivers.rows.length === 0) {
      return res.status(404).json({
        message: 'No active drivers found within the specified radius',
        status: false,
      });
    }

    const drivers = [];
    for (const driver of activeDrivers.rows) {
      const cars = await pool.query(
        'SELECT * FROM uploaded_cars WHERE driver_id = $1',
        [driver.id]
      );

      const reviews = await pool.query(
        `SELECT dr.*,
          CASE 
            WHEN EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - dr.datetime)) < 60 
              THEN ROUND(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - dr.datetime))) || 's ago'
            WHEN EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - dr.datetime)) < 3600 
              THEN ROUND(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - dr.datetime)) / 60) || 'm ago'
            WHEN EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - dr.datetime)) < 86400 
              THEN ROUND(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - dr.datetime)) / 3600) || 'h ago'
            ELSE TO_CHAR(dr.datetime, 'YYYY-MM-DD HH24:MI')
          END AS time_ago
        FROM driver_reviews dr
        WHERE dr.driver_id = $1
        ORDER BY dr.id`,
        [driver.id]
      );

      
      const resolvedReviewsData =  reviews.rows;

      const pickupDistance = driver.distance;
      const destinationDistance = calculateDistance(
        driver.latitude,
        driver.longitude,
        destinationLatitude,
        destinationLongitude
      );

      const totalDistance = pickupDistance + destinationDistance;
      const speed = 40 / 60; // km per minute
      const baseFare = 0.4; // in dollars
      const perKilometerFare = 1.2; // in dollars
      const totalFare = new Intl.NumberFormat().format(baseFare + totalDistance * perKilometerFare);
      const etaInMinutes = Math.floor(totalDistance / speed);
      let eta;
      if (etaInMinutes < 60) {
        eta = `${etaInMinutes} mins`;
      } else {
        const hours = Math.floor(etaInMinutes / 60);
        const remainingMinutes = etaInMinutes % 60;
        eta = `${hours}h ${remainingMinutes}mins`;
      }


      let cent = ''
      let actualVal = ''
      if(totalFare.includes(".")){
        cent = totalFare.split(".")[1]
        actualVal = totalFare.split(".")[0]
      }else{
        cent = '00'
        actualVal = totalFare
      }

      if (cars.rows.length > 0) {
        drivers.push({
          ...driver,
          cars: cars.rows,
          eta: `${eta}`,
          fare: `${actualVal}`,
          fareCent: cent,
          reviews: resolvedReviewsData,
        });
      }
    }

    res.status(200).json({ drivers, status: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Internal Server Error', status: false });
  }
});



app.post('/fetch-chats', async (req, res) => {
  try {
    const { driver_id, passenger_id } = req.body;

    console.log('Message request body: ', req.body);

    // Input validation
    if (!driver_id || !passenger_id) {
      return res.status(400).json({
        message: 'Driver and passenger IDs are required.',
        status: false,
      });
    }

    // Fetch chats from database
    const chats = await pool.query(
      `SELECT *, 
        CASE 
          WHEN EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - time_sent)) < 60 
            THEN ROUND(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - time_sent))) || 's ago'
          WHEN EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - time_sent)) < 3600 
            THEN ROUND(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - time_sent)) / 60) || 'm ago'
          WHEN EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - time_sent)) < 86400 
            THEN ROUND(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - time_sent)) / 3600) || 'h ago'
          ELSE TO_CHAR(time_sent, 'YYYY-MM-DD HH24:MI')
        END AS time_sent_formatted
       FROM chats
       WHERE (driver_id = $1 AND passenger_id = $2) OR (driver_id = $2 AND passenger_id = $1)
       ORDER BY id ASC`,
      [driver_id, passenger_id]
    );

    res.status(200).json({
      status: true,
      chats: chats.rows,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: 'Internal Server Error',
      status: false,
    });
  }
});



app.post('/book-ride', async (req, res) => {
  try {
    const { driver_id, passenger_id, from_latitude, from_longitude, destination_latitude, 
      destination_longitude, book_amount, place, car_id, destination_place } = req.body;

    // Input validation
    if (!passenger_id || !from_latitude || !from_longitude || !destination_latitude || !destination_longitude || !book_amount) {
      return res.status(400).json({ message: 'Required fields are missing', status: false });
    }

    console.log('book request:', req.body)

    // Generate unique booking code
    let bookingCode;
    let isUnique = false;
    while (!isUnique) {
      bookingCode = Math.floor(1000 + Math.random() * 9000).toString();
      const existingBooking = await pool.query(
        `SELECT * FROM bookings WHERE booking_code = $1`,
        [bookingCode]
      );
      if (existingBooking.rows.length === 0) {
        isUnique = true;
      }

    }

    const currentTime = new Date();

// Format date and time using toLocaleString
const formattedDateTime = currentTime.toLocaleString('en-US', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});


    // Insert booking into database
    const result = await pool.query(
      `INSERT INTO bookings (passenger_id, from_latitude, from_longitude, destination_latitude, destination_longitude, book_amount, status, booking_code, driver_id, place, car_id, destination_place, booktime)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8, $9, $10, $11) RETURNING *`,
      [passenger_id, from_latitude, from_longitude, destination_latitude, destination_longitude, book_amount, bookingCode, driver_id, place, car_id, destination_place, formattedDateTime]
    );


    res.status(201).json({
      message: 'Ride has been booked! Driver will be notified.',
      status: true,
      booking_id: result.rows[0].id,
      booking_code: bookingCode
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal Server Error', status: false });
  }
});



app.post('/hail-passenger', async (req, res) => {
  try {
    const { booking_code } = req.body;

    // Validate input data
    if (!booking_code) {
      return res.status(400).json({ message: 'Booking code is required', status: false });
    }

    // Get passenger ID from bookings table
    const getPassengerQuery = {
      text: `SELECT passenger_id FROM bookings
             WHERE booking_code = $1`,
      values: [booking_code],
    };

    const passengerResult = await pool.query(getPassengerQuery);

    if (passengerResult.rows.length === 0) {
      return res.status(404).json({ message: 'Booking not found', status: false });
    }

    const passengerId = passengerResult.rows[0].passenger_id;

    // Get user's email from users table
    const getUserEmailQuery = {
      text: `SELECT email FROM users
             WHERE id = $1`,
      values: [passengerId],
    };

    const emailResult = await pool.query(getUserEmailQuery);

    if (emailResult.rows.length === 0) {
      return res.status(404).json({ message: 'User not found', status: false });
    }

    const userEmail = emailResult.rows[0].email;

    // Send email to user
    const mailOptions = {
      subject: 'Your Driver is On the Way',
      text: `Hello, your driver is on the way to pick you up. Please stand by.`,
    };

    sendMailMessage(mailOptions.text, userEmail, mailOptions.subject)
    return res.status(200).json({ message: 'Passenger has been alerted, please goto pickup location!', status: true });


  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Failed to hail passenger', status: false });
  }
});


app.post('/book-status', async (req, res) => {
  try {
    const { booking_code } = req.body;

    // Input validation
    if (!booking_code) {
      return res.status(400).json({ message: 'Booking code is required', ok: false });
    }

    console.log('book status request:', req.query)

    // Fetch booking status from database
    const result = await pool.query(
      `SELECT * FROM bookings WHERE booking_code = $1`,
      [booking_code]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Booking not found', ok: false, });
    }

    const bookingStatus = result.rows[0].status;

    res.status(200).json({
      message: 'Booking status fetched successfully',
      status: true,
      booking_status: bookingStatus
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal Server Error', status: false });
  }
});


app.post('/driver/update/account', async (req, res) => {
  try {
    const { id } = req.body;

    // Validate input data
    if (!id) {
      return res.status(400).json({ message: 'Driver ID is required', status: false });
    }

    // Fetch driver data
    const query = {
      text: `SELECT * FROM drivers
             WHERE id = $1`,
      values: [id],
    };

    const result = await pool.query(query);

    // Check if driver found
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Driver not found', status: false });
    }

    res.status(200).json({
      message: 'Driver data fetched successfully!',
      data: result.rows[0],
      status: true
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal Server Error', status: false });
  }
});


const MERCHANT_SECRET = 'wh2JYcbBKiC6QSq8H1lEGNtgt';


function verify(signature, secret, payloadBody) {
  let hash = crypto.createHmac('sha256', secret);
  hash = hash.update(payloadBody).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(signature));
}

app.post('/driver/kyc', async (req, res) => {
  try {
  
   const signature = req.headers['x-metamap-signature'];
  const payloadBody = JSON.stringify(req.body);

  const isValidPayload = verify(signature, MERCHANT_SECRET, payloadBody);
let id = 0;
  if (isValidPayload) {
    console.log('Valid payload:', req.body);
    id  = req.body.metadata.id
    res.status(200).send('Webhook received successfully!');
  } else {
    console.log('Invalid payload:', req.body);
    res.status(401).send('Invalid signature!');
  }

    console.log('driver kyc verification data:', req.params)

    // Validate input data
    if (!id) {
      return res.status(400).json({ message: 'Driver ID is required',status: false });
    }

    // Update KYC verified status
    const query = {
      text: `UPDATE drivers
             SET verified = TRUE
             WHERE id = $1
             RETURNING *`,
      values: [id],
    };

    const result = await pool.query(query);

    // Check if update was successful
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Driver not found',status: false });
    }

    res.json({
      message: 'KYC verified successfully!',
      data: result.rows[0],
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal Server Error',status: false });
  }
});

app.post('/driver/fetch-balance', async (req, res) => {
  try {
    const { id } = req.body;

    console.log('fetch balance for id:',id)
   

    // Fetch user balance
    let result = await pool.query(
      'SELECT account_balance FROM drivers WHERE id = $1',
      [id]
    );

    // Check if user exists
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Wallet ID not found. Logout and login back your account.', status: false });
    }

    const balance = result.rows[0].account_balance;

    res.status(200).json({
      message: 'User balance fetched successfully',
      balance,
      status: true,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Internal Server Error', status: false });
  }
});


app.post('/fetch-balance', async (req, res) => {
  try {
    const { id } = req.body;

    console.log('fetch balance for id:',id)
   

    // Fetch user balance
    let result = await pool.query(
      'SELECT account_balance FROM users WHERE id = $1',
      [id]
    );

    // Check if user exists
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Wallet ID not found. Logout and login back your account.', status: false });
    }

    const balance = result.rows[0].account_balance;

    res.status(200).json({
      message: 'User balance fetched successfully',
      balance,
      status: true,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Internal Server Error', status: false });
  }
});


app.post('/bookings', async (req, res) => {
  try {
    const { status, userId } = req.body;

    console.log('Fetch bookings request:', req.body);

    // Fetch booking status from database
    const result = await pool.query(
      `SELECT * FROM bookings 
       WHERE (passenger_id = $1 OR driver_id = $1) 
       AND status = $2`,
      [userId, status]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Bookings not found', ok: false });
    }

    const bookingsData = result.rows;
    const bookingsArray = [];



    for (const booking of bookingsData) {
      const cars = await pool.query(
        'SELECT * FROM uploaded_cars WHERE driver_id = $1',
        [booking.driver_id]
      );

      const fetchDrivers = await pool.query('SELECT * FROM drivers WHERE id = $1', [booking.driver_id]);


      const carDetails = cars.rows.length > 0
        ? {
          carName: cars.rows[0].car_model,
          pickupType: cars.rows[0].pickupType,
          seat: cars.rows[0].seats,
        }
        : {
          carName: 'None',
          seat: 'None',
          pickupType:'None'
        };

      bookingsArray.push({
        info: booking,
        car: carDetails,
        driver: fetchDrivers.rows[0]
      });
    }

    res.status(200).json({
      message: 'Bookings fetched successfully',
      status: true,
      bookings: bookingsArray,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal Server Error', status: false, error: error.message });
  }
});


app.post('/vehicles/delete-vehicle', async (req, res) => {
  console.log('delete vehicle body data', req.body)
  try {
    const { id,driver_id } = req.body;

    // Validate input data
    if (!id) {
      return res.status(400).json({ message: 'Vehicle ID is required', status: false });
    }

    // Delete vehicle from uploaded_cars table
    const deleteQuery = {
      text: `DELETE FROM uploaded_cars
             WHERE id = $1`,
      values: [id],
    };

    await pool.query(deleteQuery);

    // Retrieve remaining vehicles from uploaded_cars table
    const getVehiclesQuery = {
      text: `SELECT * FROM uploaded_cars WHERE driver_id = $1  ORDER BY id DESC`,
      values: [driver_id],

    };

    const result = await pool.query(getVehiclesQuery);

    // Return success response with remaining vehicles
    res.json({
      message: 'Vehicle has been deleted',
      data: result.rows,
      status: true,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Failed to delete vehicle', status: false });
  }
});


app.post('/vehicles/get-vehicles', async (req, res) => {
  try {
    const {
      driver_id,
    } = req.body;

    console.log('get vehicles for driver:', driver_id)

    console.log('getting drivers cars request', req.body)
    // Validate input data
    if (!driver_id) {
      return res.status(400).json({ error: 'Driver ID is required' });
    }

    // Retrieve vehicles from uploaded_cars table
    const query = {
      text: `SELECT * FROM uploaded_cars
             WHERE driver_id = $1 ORDER BY id DESC`,
      values: [driver_id],
    };

    const result = await pool.query(query);

    // Return success response
    if (result.rows.length > 0) {
      res.json({ message: 'Vehicles retrieved successfully', data: result.rows, status: true });
    } else {
      res.json({ message: 'No vehicles found for this driver', status: true,data:[] });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Failed to retrieve vehicles', status: true });
  }
});


app.post('/vehicle/register', async (req, res) => {
  console.log('register vehicle body data', req.body)
  try {
    const {
      driver_id,
      car_model,
      car_color,
      car_name,
      seats,
      car_number,
      phone,
      pickuptype,
      latitude,
      longitude,
    } = req.body;

    // Validate input data
    if (!driver_id || !car_model || !car_color || !car_name || !seats || !car_number || !phone || !pickuptype) {
      return res.status(400).json({ message: 'Missing required fields', status: false });
    }

    // Insert data into uploaded_cars table
    const query = {
      text: `INSERT INTO uploaded_cars (
        driver_id,
        car_model,
        car_color,
        car_name,
        car_image,
        seats,
        car_number,
        phone,
        pickuptype,
        latitude,
        longitude
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      values: [
        driver_id,
        car_model,
        car_color,
        car_name,
        'none',
        seats,
        car_number,
        phone,
        pickuptype,
        latitude,
        longitude,
      ],
    };

    const result = await pool.query(query);

    // Update organisation column in drivers table
    const updateQuery = {
      text: `UPDATE drivers
             SET organisation = $1
             WHERE id = $2`,
      values: [car_name, driver_id],
    };

    await pool.query(updateQuery);

    const getVehiclesQuery = {
      text: `SELECT * FROM uploaded_cars WHERE driver_id = $1  ORDER BY id DESC`,
      values: [driver_id],

    };

    const vehiclesRes = await pool.query(getVehiclesQuery);

    // Return success response
    res.json({ message: 'Vehicle has been registered and can now be used for pickup services', data: vehiclesRes.rows, status: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Failed to register vehicle', status: false });
  }
});


app.post('/driver/location', async (req, res) => {
  try {
    const { id } = req.body;

    console.log('driver location request:', req.body);

    const driverLocation = await pool.query('SELECT * FROM drivers WHERE id = $1', [id]);

    res.status(200).json({
      message: 'Driver current location fetched',
      status: true,
      bookings: driverLocation.rows[0],
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal Server Error', status: false, error: error.message });
  }
});

app.post('/all-bookings', async (req, res) => {
  try {
    const { userId } = req.body;

    console.log('Fetch all bookings request:', req.body);

    if (!userId) {
      return res.status(400).json({ message: 'User ID is required', status: false });
    }

    const result = await pool.query(
      `SELECT * FROM bookings WHERE (status = 'pending' OR status = 'accepted') AND passenger_id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(200).json({ 
        message: 'No bookings found for this user', 
        status: false, 
        count: 0 
      });
    }

    const bookingsData = result.rows;

    res.status(200).json({
      message: 'Bookings fetched successfully',
      status: true,
      count: bookingsData.length,
      data: bookingsData
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ 
      message: 'Internal Server Error', 
      status: false, 
      error: error.message 
    });
  }
});

app.post('/reject-ride', async (req, res) => {
  try {
    const { id } = req.body;

    // Input validation
    if (!id) {
      return res.status(400).json({ message: 'Ride ID is required', status: false });
    }

    // Update ride status to rejected
    const result = await pool.query(
      `UPDATE bookings SET status = 'rejected' WHERE id = $1 RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Ride not found', status: false });
    }

    res.status(200).json({
      message: 'Ride rejected successfully',
      ride: result.rows[0],
      status: true
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal Server Error', status: false });
  }
});



app.post('/cancel-ride', async (req, res) => {
  try {
    const { id } = req.body;


    console.log('cancel ride request:', req.body)

    // Update booking status in database
    const result = await pool.query(
      `DELETE FROM bookings WHERE booking_code = $1`,
      [id]
    );

    sendMailMessage('Hey! your ride was cancelled by driver. Driver may be busy at the moment, request another ride.','anoibi@47gmail.com','Ride canncelled')


    res.status(200).json({
      message: 'Ride cancelled successfully',
      booking: result.rows[0],
      status: true
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal Server Error', status: false });
  }
});


app.post('/accept-ride', async (req, res) => {
  try {
    const { id, passenger_id } = req.body;

    console.log('Accept ride request:', req.body)

    // Update booking status in database
    const result = await pool.query(
      `UPDATE bookings SET status = 'accepted' WHERE booking_code = $1 AND passenger_id = $2 RETURNING *`,
      [id, passenger_id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ message: 'Booking not found', status: false });
    } else {
      res.status(200).json({
        message: 'Ride accepted successfully',
        booking: result.rows[0],
        status: true
      });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal Server Error', status: false });
  }
});

app.patch('/complete-ride', async (req, res) => {
  try {
    const { id } = req.body;

    // Input validation
    if (!id) {
      return res.status(400).json({ message: 'Ride ID is required', status: false });
    }

    // Update ride status to completed
    const result = await pool.query(
      `UPDATE bookings SET status = 'completed' WHERE id = $1 RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Ride not found', status: false });
    }

    res.status(200).json({
      message: 'Ride completed successfully',
      ride: result.rows[0],
      status: true
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal Server Error', status: false });
  }
});

app.post('/chats', async (req, res) => {
  try {
    const { message, driver_id, passenger_id, driver } = req.body;

    console.log('message intent:', req.body)

    // Input validation
    if (!message || !driver_id || !passenger_id || typeof driver !== 'boolean') {
      return res.status(400).json({
        message: 'Message, driver ID, passenger ID and driver status are required.',
        status: false,
      });
    }

    // Insert chat message into database
    await pool.query(
      `INSERT INTO chats (message, driver_id, passenger_id, time_sent, driver)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP, $4)`,
      [message, driver_id, passenger_id, driver]
    );

    res.status(201).json({
      message: 'Chat message inserted successfully',
      status: true,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: 'Internal Server Error',
      status: false,
    });
  }
});

app.post('/recent-chats', async (req, res) => {
  try {
    const { id } = req.body;

    console.log('recent chats request', req.body)

    // Validation
    if (!id) {
      return res.status(400).json({
        message: 'User ID is required',
        status: false,
      });
    }

    // Query to fetch recent chats
    const recentChatsQuery = `
      SELECT 
        c.id,
        c.message,
        c.time_sent,
        c.driver_id,
        c.passenger_id
      FROM 
        chats c
      WHERE 
        (c.driver_id = $1 OR c.passenger_id = $1)
        AND 
        c.id IN (
          SELECT 
            MAX(id) 
          FROM 
            chats 
          GROUP BY 
            driver_id, 
            passenger_id 
        )
      ORDER BY 
        c.time_sent DESC;
    `;

    const result = await pool.query(recentChatsQuery, [id]);

    // Format time_sent to "2mins ago", "1hr ago", etc.
    const recentChats = await Promise.all(result.rows.map(async (chat) => {
      const timeDiff = (Date.now() - chat.time_sent.getTime()) / 1000;
      let timeAgo;

      console.log(chat)

      if (timeDiff < 60) {
        timeAgo = `${Math.floor(timeDiff)}s ago`;
      } else if (timeDiff < 3600) {
        timeAgo = `${Math.floor(timeDiff / 60)}mins ago`;
      } else {
        timeAgo = `${Math.floor(timeDiff / 3600)}hr ago`;
      }

      // Fetch driver and passenger names
      const driver = await pool.query('SELECT * FROM drivers WHERE id = $1', [chat.driver_id]);
      const passenger = await pool.query('SELECT * FROM users WHERE id = $1', [chat.passenger_id]);

      return {
        ...chat,
        time_sent: timeAgo,
        driver_name: driver.rows[0]?.name,
        passenger_name: passenger.rows[0]?.name,
      };
    }));

    res.status(200).json({
      message: 'Recent chats fetched successfully',
      status: true,
      data: recentChats,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: 'Internal Server Error',
      status: false,
    });
  }
});


app.post('/recent-chats', async (req, res) => {
  try {
    const { id } = req.body;

    console.log('recent chats request', req.body)

    // Validation
    if (!id) {
      return res.status(400).json({
        message: 'User ID is required',
        status: false,
      });
    }

    // Query to fetch recent chats
    const recentChatsQuery = `
      SELECT 
        c.id,
        c.message,
        c.time_sent,
        c.driver_id,
        c.passenger_id
      FROM 
        chats c
      WHERE 
        (c.driver_id = $1 OR c.passenger_id = $1)
        AND 
        c.id IN (
          SELECT 
            MAX(id) 
          FROM 
            chats 
          GROUP BY 
            driver_id, 
            passenger_id 
        )
      ORDER BY 
        c.time_sent DESC;
    `;

    const result = await pool.query(recentChatsQuery, [id]);

    // Format time_sent to "2mins ago", "1hr ago", etc.
    const recentChats = await Promise.all(result.rows.map(async (chat) => {
      const timeDiff = (Date.now() - chat.time_sent.getTime()) / 1000;
      let timeAgo;

      console.log(chat)

      if (timeDiff < 60) {
        timeAgo = `${Math.floor(timeDiff)}s ago`;
      } else if (timeDiff < 3600) {
        timeAgo = `${Math.floor(timeDiff / 60)}mins ago`;
      } else {
        timeAgo = `${Math.floor(timeDiff / 3600)}hr ago`;
      }

      // Fetch driver and passenger names
      const driver = await pool.query('SELECT * FROM drivers WHERE id = $1', [chat.driver_id]);
      const passenger = await pool.query('SELECT * FROM users WHERE id = $1', [chat.passenger_id]);

      return {
        ...chat,
        time_sent: timeAgo,
        driver_name: driver.rows[0]?.name,
        passenger_name: passenger.rows[0]?.name,
      };
    }));

    res.status(200).json({
      message: 'Recent chats fetched successfully',
      status: true,
      data: recentChats,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: 'Internal Server Error',
      status: false,
    });
  }
});

// Function to calculate distance between two points
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const lat1Rad = lat1 * Math.PI / 180;
  const lat2Rad = lat2 * Math.PI / 180;

  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1Rad) * Math.cos(lat2Rad);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;

  return distance;
}


app.post('/reset-password', async (req, res) => {
  try {
   // console.log('req data', req.body);

    const { password, email } = req.body;

    console.log('password:', password)
    console.log('email:', email)

    // Check if user exists
    const existingUser = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );

    if (existingUser.rows.length === 0) {
      return res.status(404).json({ message: 'Email does not exist', status: false });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Update user password
    await pool.query(
      'UPDATE users SET password = $1 WHERE email = $2',
      [hashedPassword, email]
    );


    res.status(200).json({ message: 'Password reset successfully!', status: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Internal Server Error', status: false });
  }
});


app.post('/verify-email', async (req, res) => {
  const { email } = req.body;

  // Insert the OTP into the database
  
  try {
    const otpCode = Math.floor(1000 + Math.random() * 9000).toString();
    sendMail(otpCode, email, 'Password Reset- OTP Code')
    // Insert OTP into otp table
   const ins =  await pool.query(
      'INSERT INTO verification (email, otp_code) VALUES ($1, $2)',
      [email, otpCode]
    );

    res.status(201).json({
      message: 'OTP code sent to your email',
      status: true,
    });

  } catch (err) {
    console.error('Error inserting OTP:', err);
    res.status(201).json({
      message: err.message,
      status: false,
    });
    // Handle the error, e.g., rollback the user creation
  }


    });

  app.post('/send-otp', async (req, res) => {
  const { email, otp_code } = req.body;

  // Create new user

  try {
    const otpCode = Math.floor(1000 + Math.random() * 9000).toString();

    sendMail(otpCode, email, 'Yasser - OTP Code');


    // Insert OTP into otp table
    await pool.query(
      'INSERT INTO verification (email, otp_code) VALUES ($1, $2)',
      [email, otpCode]
    );

    res.status(201).json({
      message: 'OTP code sent to your email',
      status: true,
    });

  } catch (err) {
    console.error('Error inserting OTP:', err);
    // Handle the error, e.g., rollback the user creation
    res.status(201).json({
      message: 'OTP code could not sent to your email',
      status: false,
    });
  }


});






app.put('/reject-booking/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query('UPDATE bookings SET accepted = rejected WHERE id = ?', id);

    res.json({ message: 'Booking updated successfully!' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});



app.post('/add-bookings', async (req, res) => {
  const { passenger_id, driver_id, from_latitude, from_longitude, destination_latitude, destination_longitude } = req.body;

  try {
    const result = await pool.query('INSERT INTO bookings SET ?', {
      passenger_id,
      driver_id,
      from_latitude,
      from_longitude,
      destination_latitude,
      destination_longitude
    });

    res.json({ message: 'Booking added successfully!' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});


app.put('/accept-booking/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query('UPDATE bookings SET accepted = accepted WHERE id = ?', id);

    res.json({ message: 'Booking updated successfully!' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});

app.post('/verify-otp', async (req, res) => {


  console.log('REQUEST BODY', req.body);

  const { email, otp } = req.body;

  console.log('Email:', email);
  console.log('OTP Code:', otp);

  try {
    const result = await pool.query(
      'SELECT * FROM verification WHERE email = $1 AND otp_code = $2',
      [email, otp]
    );

    console.log('Query Result:', result);

    if (result.rowCount > 0) {
      await pool.query('DELETE FROM verification WHERE email = $1', [email]);
      await pool.query('UPDATE users SET verified = $1 WHERE email = $2', [1, email]);

      res.status(200).json({ message: 'OTP verified successfully!', status: true });
    } else {
      res.status(401).json({ message: 'Invalid OTP code', status: false });
    }
  } catch (error) {
    console.error('SQL Error:', error);
    res.status(500).json({ message: 'Internal Server Error', status: false });
  }
});


app.post('/upload-car', async (req, res) => {
  const { driver_id, car_model, car_color, car_name, car_image } = req.body;

  // Create a new uploaded car
  const uploadedCar = {
    driver_id,
    car_model,
    car_color,
    car_name,
    car_image
  };

  // Save the uploaded car to the database
  try {
    const result = await pool.query('INSERT INTO uploaded_cars SET ?', uploadedCar);
    res.json({ message: 'Car uploaded successfully!' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});


app.post('/transactions', async (req, res) => {
  const { id } = req.body;

  console.log('transactions request body:', req.body)

  // Validate input data
  if (!id) {
    return res.status(400).json({ message: 'User ID is required', status: false  });
  }

  // Fetch transactions from database
  try {
    const query = {
      text: `SELECT * FROM transactions
             WHERE user_id = $1`,
      values: [id],
    };

    const result = await pool.query(query);
    res.status(200).json({ 
      message: 'Transactions fetched successfully!', 
      data: result.rows ,
      status: true
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal Server Error', status: false });
  }

});

app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    console.log('request', req.body)
    const user = await getUserByEmail(email);
    if (!user) {
      return res.status(401).json({ message: 'Invalid email', status: false });
    }
    const isValidPassword = await comparePasswords(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ message: 'Invalid password', status: false });
    }
    // Remove sensitive information like password

    delete user.password;
    res.status(200).json({
      message: 'Login successful!',
      status: true,
      userData: user
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});



app.post('/driver/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    console.log('driver login request', req.body)
    const user = await getDriverByEmail(email);
    if (!user) {
      return res.status(401).json({ message: 'Invalid email', status: false });
    }
    const isValidPassword = await comparePasswords(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ message: 'Invalid password', status: false });
    }
    // Remove sensitive information like password

    delete user.password;
    res.status(200).json({
      message: 'Login successful!',
      status: true,
      userData: user
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});


// Helper functions
async function getUserByEmail(email) {
  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    return result.rows[0];
  } catch (error) {
    console.error(error);
    return null;
  }
}


// Helper functions
async function getDriverByEmail(email) {
  try {
    const result = await pool.query('SELECT * FROM drivers WHERE email = $1', [email]);
    return result.rows[0];
  } catch (error) {
    console.error(error);
    return null;
  }
}

async function comparePasswords(plainPassword, hashedPassword) {
  // Use a library like bcrypt to compare passwords securely
  return bcrypt.compare(plainPassword, hashedPassword);
}

function generateJwtToken(user) {
  // Use a library like jsonwebtoken to generate a token
  return jwt.sign({ userId: user.id }, process.env.SECRET_KEY, { expiresIn: '1h' });
}

app.listen(port, () => {
  console.log(`Server started on port ${port}`);
});