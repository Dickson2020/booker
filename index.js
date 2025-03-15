const express = require('express');
const app = express();
const { Pool } = require('pg')
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const port = process.env.PORT || 9000; //for production use 3000
const crypto = require('crypto');
const request = require('request');
const base64js = require('base64-js');
const axios = require('axios'); // Add this line to import axios
const speakeasy = require("speakeasy");


// Increase the limit for the body-parser middleware
app.use(express.json({ limit: '50mb' })); // Parse JSON bodies with a limit of 50MB
app.use(express.urlencoded({ extended: true, limit: '50mb' })); // Parse URL-encoded bodies with a limit of 50MB
app.use(cors());


/*
const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'db',
  password: 'developer@100',
  port: 5432
});


*/

const pool = new Pool({
  user: 'kudipoi3_pgdev',
  host: '131.153.147.42',
  database: 'kudipoi3_pg',
  password: 'developer@2024',
  port: 5432
});

console.log('pool', pool)



// Function to convert image URL to Base64
async function imageUrlToBase64(url) {

  console.log('url',url)
  try {
    // Fetch the image from the URL
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    console.log('getting arrayuffer of imafe')
    // Convert the response data to a Buffer
    const buffer = Buffer.from(response.data, 'binary');
    console.log('gettingbinary of image')
    // Encode the Buffer as a Base64 string
    const base64 = base64js.fromByteArray(new Uint8Array(buffer));

    console.log('getting base64 data of image')

    return base64;
  } catch (error) {
    console.error(`Error converting image to Base64: ${error}`);
    throw error;
  }
}


async function getApiKeys() {
  try {
    const result = await pool.query('SELECT stripe_secret_key, stripe_publishable_api_key FROM settings WHERE id = 1');
    console.log('result.rows[0]:', result.rows[0])
    return result.rows[0];
  } catch (err) {
    throw err;
  }
}

let secretStripeKey = ''

let stripePublishableApiKey = ''
const stripeModule = require('stripe');
let stripe = null

async function initializeStripe() {
  let apiKeys = await getApiKeys();
  let fetchedSecretKey = apiKeys.stripe_secret_key;
  stripePublishableApiKey = apiKeys.stripe_publishable_api_key;

  stripe = stripeModule(fetchedSecretKey);

  console.log('stripe initialized', apiKeys)
  // Now you can use the stripeInstance
}







app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

app.use(express.json()); // Parse JSON bodies
app.use(express.urlencoded({ extended: true }));

// This example sets up an endpoint using the Express framework.
app.post('/webhook', express.json({ type: 'application/json' }), async (request, response) => {

  if (stripe == null) {
    await initializeStripe()
  }
  try {
    const event = request.body;


    const paymentIntent = event.data.object;

    console.log('webhook data: ', event)
    // Handle the event
    switch (event.type) {
      case 'payment_intent.succeeded':
        try {

          const paymentIntentVerification = await stripe.paymentIntents.confirm(
            paymentIntent?.id,
            {
              payment_method: paymentIntent?.payment_method,
              return_url: 'https://yessat.com',
            }
          );
          console.log('paymentIntentVerification:', paymentIntentVerification)


        } catch (err) { }


        // Get user ID from email
        const getUserQuery = await pool.query('SELECT * FROM users WHERE stripe_customer_id = $1', [paymentIntent?.customer]);
        const userId = getUserQuery.rows[0].id;
        const email = getUserQuery.rows[0].email;
        const pushToken = getUserQuery.rows[0].token;

        console.log('user id:,', userId)

        // Generate a unique transaction ID
        let transactionId;
        let isUnique = false;

        while (!isUnique) {
          transactionId = uuidv4();
          const existingTransaction = await pool.query(
            'SELECT * FROM transactions WHERE transaction_id = $1',
            [transactionId]
          );

          if (existingTransaction.rows.length === 0) {
            isUnique = true;
          }
        }

        // Get user's previous balance
        const getUserPreviousBalance = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);

        // Send deposit notification email
        sendMailMessage('Transaction Notification, ' + getUserPreviousBalance.rows[0].name + ', you have received a payment of $' + paymentIntent.amount / 100, email, 'Transaction Notification')
        await pushNotification('Transaction Notification','Hi! '+getUserPreviousBalance.rows[0].name + ', you have received a payment of $' +( paymentIntent.amount / 100),pushToken)
        // Update account balance
        const newBalance = Number(getUserPreviousBalance.rows[0].account_balance) + Number(paymentIntent.amount / 100);
        await pool.query(
          'UPDATE users SET account_balance =  $1 WHERE id = $2',
          [newBalance, userId]
        );

        // Insert transaction
        const charges = ((paymentIntent.amount / 100) * 0.014)  //1.4 percent charge
        await pool.query(
          'INSERT INTO transactions (user_id, description, amount, status, transaction_date, transaction_type, transaction_id,intent,intent_type, charges) VALUES ($1, $2, $3, $4, $5, $6, $7,$8, $9, $10)',
          [
            userId,
            'Wallet deposit',
            ((paymentIntent.amount / 100) - charges),
            'Successful',
            new Date().toISOString(),
            'Credit',
            transactionId,
            paymentIntent?.id,
            'payment',
            '$' + charges
          ]
        );

        // Return updated user data
        const updatedUser = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);

        // Return a response to acknowledge receipt of the event
        response.json({ received: true });
        break;

      case 'payout.failed':
        // Then define and call a method to handle the successful attachment of a PaymentMethod.
        // handlePaymentMethodAttached(paymentMethod);
        // Get user ID from email
        const getUserQueryTrx = await pool.query('SELECT * FROM transactions WHERE intent = $1', [paymentIntent?.id]);
        const getUserQueryUser = await pool.query('SELECT * FROM drivers WHERE id = $1', [getUserQueryTrx?.rows[0]?.user_id]);
        const emailUser = getUserQueryUser.rows[0]?.email;

        console.log(' getUserQueryTrx.rows[0]:', getUserQueryTrx.rows[0])

        console.log(' getUserQueryUser.rows[0]:', getUserQueryUser.rows[0])


        sendMailMessage(paymentIntent?.failure_message, emailUser, 'Payout failed')

        await pool.query(
          'UPDATE transactions SET status = $1, description = $2 WHERE intent = $3',
          ['Failed', 'Error: ' + paymentIntent?.failure_message, paymentIntent?.id]
        );

        break;
      // ... handle other event types

      case 'payout.paid':
        // Then define and call a method to handle the successful attachment of a PaymentMethod.
        // handlePaymentMethodAttached(paymentMethod);
        // Get user ID from email
        const getUserQueryTrx2 = await pool.query('SELECT * FROM transactions WHERE intent = $1', [paymentIntent?.id]);
        const getUserQueryUser2 = await pool.query('SELECT * FROM drivers WHERE id = $1', [getUserQueryTrx2?.rows[0]?.user_id]);
        const emailUser2 = getUserQueryUser2.rows[0]?.email;
        const userIdx = getUserQueryUser2.rows[0]?.id;
        const token = getUserQueryUser2.rows[0]?.token;

        console.log(' getUserQueryUser2.rows[0]:', getUserQueryUser2.rows[0])

        console.log('user id:,', userIdx)
        sendMailMessage('Payout of $' + paymentIntent?.amount + ', was successfully processed!', emailUser2, 'Payout Successful')
        await pushNotification('transaction successful','Payout of $' + paymentIntent?.amount + ', was successfully processed!',token)


        await pool.query(
          'UPDATE transactions SET status = $1, description = $2 WHERE intent = $3 ',
          ['Successful', 'Payout to Bank Successful', paymentIntent?.id]
        );

        break;
      // ... handle other event types
      default:
        console.log(`Unhandled event type ${event.type}`);
    }
  } catch (error) {
    console.error(error);
    response.status(500).json({ received: false });
  }
});



app.post('/initiate-withdrawal', async (req, res) => {
  try {
    const { id, amount, type, customerId } = req.body;

    console.log('initiate withdrawal:', req.body);
    let TOKEN = id;
    let source_type = type;

    const query = {
      text: `SELECT * FROM drivers
             WHERE id = $1;`,
      values: [customerId]
    };

    const fetchCustomerStripeID = await pool.query(query);
    const customerIdResponse = fetchCustomerStripeID.rows[0];
    let customerIDStripe = '';

    if (customerIdResponse?.stripe_account_id.length > 1) {
      customerIDStripe = customerIdResponse?.stripe_account_id;

      const balance = await stripe.balance.retrieve(
        {
          expand: ['instant_available.net_available'],
        },
        {
          stripeAccount: customerIDStripe,
        }
      );

      const availableStripeBalance = balance.instant_available[0]?.net_available[0]?.amount;

      console.log('availableStripeBalance: ', balance)

      if (availableStripeBalance == 0 || availableStripeBalance < amount) {
        res.status(500).json({ message: 'Insufficient wallet balance', status: false });

      } else {

        const payout = await stripe.payouts.create(
          {
            amount: amount, // Use the amount from the request body
            currency: 'usd',
            method: 'instant',
            destination: TOKEN,
          },
          {
            stripeAccount: customerIDStripe,
          }
        );

        console.log('payout: ', payout);


        // Generate a unique transaction ID
        let transactionId;
        let isUnique = false;

        while (!isUnique) {
          transactionId = uuidv4();
          const existingTransaction = await pool.query(
            'SELECT * FROM transactions WHERE transaction_id = $1',
            [transactionId]
          );

          if (existingTransaction.rows.length === 0) {
            isUnique = true;
          }
        }

        // Get user's previous balance


        if (payout?.status) {
          await pool.query(
            'INSERT INTO transactions (user_id, description, amount, status, transaction_date, transaction_type, transaction_id, intent,intent_type, charges ) VALUES ($1, $2, $3, $4, $5, $6, $7,$8,$9, $10)',
            [
              customerId,
              payout?.type == 'bank_account' ? 'Payout to Bank created' : 'Payout created',
              amount,
              'Pending',
              new Date().toISOString(),
              'Debit',
              transactionId,
              payout?.id,
              'external-payout',
              '0%'
            ]
          );
        }

        res.status(200).json({ message: 'Payout request has been initiated and pending and processing, you will be notified soon!', status: true });
      }
    } else {
      res.status(500).json({ message: 'Invalid stripe customer ID', status: false });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'An error occurred', status: false });
  }
});


// Endpoint to update stripe_connect_id for a driver
app.get('/onboard-stripe', (req, res) => {


  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Success!</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          text-align: center;
          padding: 20px;
          background-color: #f9f9f9;
        }
        h1 {
          font-size: 24px;
          margin-bottom: 10px;
        }
        .button {
          background-color: #4CAF50;
          color: #fff;
          padding: 12px 20px;
          border: none;
          border-radius: 5px;
          cursor: pointer;
        }
        .button:hover {
          background-color: #000;
        }
      </style>
    </head>
    <body>
      <h1>Setup completed!</h1>
      <p>You wallet has been successfully setup. Kindly wait for some minutes for connection to establish in app and start driving. Please close this page and go back to the app.</p>
    </body>
    </html>
  `);
});
app.get('/refresh-account-link', async (req, res) => {
  const { user, id, url } = req.query;
  let customerId = user

  console.log('refresh connect link', req.query)

  if (stripe == null) {
    await initializeStripe()
  }
  try {




    if (!id) {

      const query = {
        text: `UPDATE drivers
               SET stripe_account_id = $1
               WHERE id = $2;`,
        values: [null, customerId]

      };

      // Execute query
      await pool.query(query);
      return res.status(400).send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Error</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              text-align: center;
              padding: 20px;
              background-color: #f9f9f9;
            }
            h1 {
              font-size: 24px;
              margin-bottom: 10px;
            }
          </style>
        </head>
        <body>
          <h1>Error: Missing ID parameter</h1>
          <p>Please provide a valid ID parameter.</p>
        </body>
        </html>
      `);
    }

    const accountLink = await stripe.accountLinks.create({
      account: id,
      refresh_url: url + '/refresh-account-link?user=' + user + '&url=' + url + '&id=' + id,
      return_url: url + '/onboard-stripe',
      type: 'account_onboarding',
    });

    const link = accountLink.url;

    console.log(accountLink);

    return res.redirect(link);
  } catch (error) {

    console.log(error)

    const query = {
      text: `UPDATE drivers
             SET stripe_account_id = $1
             WHERE id = $2;`,
      values: [null, customerId]

    };

    // Execute query
    await pool.query(query);


    return res.status(500).send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Error</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            text-align: center;
            padding: 20px;
            background-color: #f9f9f9;
          }
          h1 {
            font-size: 24px;
            margin-bottom: 10px;
          }
        </style>
      </head>
      <body>
        <h1>Error: Failed to create account link</h1>
        <p>Please try again later or contact support.</p>
      </body>
      </html>
    `);


  }
});

app.post('/connect-wallet', async (req, res) => {
  // Use an existing Customer ID if this is a returning customer.
  const { customerId, url } = req.body

  //  console.log('connect wallet: ', req.body)

  console.log('api keys:', { secret: secretStripeKey, publishableKey: stripePublishableApiKey })


  if (stripe == null) {
    await initializeStripe()
  }

  const query = {
    text: `SELECT * FROM drivers
           WHERE id = $1;`,
    values: [customerId]
  };

  // Execute query
  const fetchCustomerStripeID = await pool.query(query);
  let customerIdResponse = fetchCustomerStripeID.rows[0]
  let customerIDStripe = '';

  console.log(customerIdResponse)
  let customerAccountId = customerIdResponse?.stripe_account_id
  if (customerIdResponse?.stripe_account_id === null) {
    console.log('customer CONNECT ID does not exists')

    const account = await stripe.accounts.create({
      country: 'US',
      email: customerIdResponse.email,
      controller: {
        fees: {
          payer: 'application',
        },
        losses: {
          payments: 'application',
        },
        stripe_dashboard: {
          type: 'none',
        },
        requirement_collection: 'application'
      },
      country: 'US',
      capabilities: {
        transfers: {
          requested: true,
        },
      },
    });


    const query = {
      text: `UPDATE drivers
         SET stripe_account_id = $1
         WHERE id = $2;`,
      values: [account.id, customerId]

    };

    // Execute query
    await pool.query(query);

    //console.log(account)

    const accountLink = await stripe.accountLinks.create({
      account: account.id,
      refresh_url: url + '/refresh-account-link?url=' + url + '&user=' + customerId + '&id=' + account.id,
      return_url: url + '/onboard-stripe',
      type: 'account_onboarding',
    });

    //console.log(accountLink)  

    res.status(200).json({ message: 'Please you need to connect driver app to Stripe to start  collecting payout!', onboard: true, accountLink });


  } else {

    try {

      const account = await stripe.accounts.retrieve(customerAccountId);

      //console.log('retrieve account data', account)

      if (account?.charges_enabled) {
        res.status(200).json({ message: 'Account connected! Proceed', onboard: false, id: customerAccountId });
      } else {
        const accountLink = await stripe.accountLinks.create({
          account: customerAccountId,
          refresh_url: url + '/refresh-account-link?url=' + url + '&user=' + customerId + '&id=' + customerAccountId,
          return_url: url + '/onboard-stripe',
          type: 'account_onboarding',
        });

        //console.log(accountLink)  

        res.status(200).json({ message: 'Please you need to connect driver app to Stripe to start  collecting payout!', onboard: true, accountLink });

      }
    } catch (err) {
      const accountLink = await stripe.accountLinks.create({
        account: customerAccountId,
        refresh_url: url + '/refresh-account-link?url=' + url + '&user=' + customerId + '&id=' + customerAccountId,
        return_url: url + '/onboard-stripe',
        type: 'account_onboarding',
      });

      // console.log(accountLink)  

      res.status(200).json({ message: 'Please you need to connect driver app to Stripe to start  collecting payout!', onboard: true, accountLink });

    }


  }

});



app.post('/payment-sheet', async (req, res) => {
  // Use an existing Customer ID if this is a returning customer.
  const { customerId, amount } = req.body

  console.log('payment sheet: ', req.body)

  if (stripe == null) {
    await initializeStripe()
  }

  const query = {
    text: `SELECT * FROM users
           WHERE id = $1;`,
    values: [customerId]
  };

  // Execute query
  const fetchCustomerStripeID = await pool.query(query);
  let customerIdResponse = fetchCustomerStripeID.rows[0]
  let customerIDStripe = '';
  if (customerIdResponse?.stripe_customer_id !== "") {
    customerIDStripe = customerIdResponse?.stripe_customer_id
    console.log('stripe customer already exits')
    if (customerIDStripe === null) {
      const customer = await stripe.customers.create();
      customerIDStripe = customer.id

      const query = {
        text: `UPDATE users
               SET stripe_customer_id = $1
               WHERE id = $2;`,
        values: [customerIDStripe, customerId]
      };

      // Execute query
      await pool.query(query);

    }
  } else {


  }

  console.log("stripe_customer_id:", customerIDStripe)

  if (customerIDStripe !== "") {

    const ephemeralKey = await stripe.ephemeralKeys.create(
      { customer: customerIDStripe },
      { apiVersion: '2024-12-18.acacia' }
    );
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amount * 100,
      currency: 'usd',
      customer: customerIDStripe,
      // In the latest version of the API, specifying the `automatic_payment_methods` parameter
      // is optional because Stripe enables its functionality by default.
      automatic_payment_methods: {
        enabled: true,
      },
    });

    res.json({
      paymentId: paymentIntent?.id,
      paymentIntent: paymentIntent.client_secret,
      ephemeralKey: ephemeralKey.secret,
      customer: customerIDStripe,
      publishableKey: stripePublishableApiKey
    });

  } else {

    console.log('Invalid stripe customer ID')
    return res.status(400).json({ message: 'Invalid stripe customer ID', status: false });


  }

});





app.post('/pre-payment-sheet', async (req, res) => {
  // Use an existing Customer ID if this is a returning customer.
  const { customerId, amount } = req.body

  console.log('payment sheet: ', req.body)

  const charges = ((amount) * 0.014)  //1.4 percent charge


  if (stripe == null) {
    await initializeStripe()
  }

  const query = {
    text: `SELECT * FROM users
           WHERE id = $1;`,
    values: [customerId]
  };

  // Execute query
  const fetchCustomerStripeID = await pool.query(query);
  let customerIdResponse = fetchCustomerStripeID.rows[0]
  let customerIDStripe = '';
  if (customerIdResponse?.stripe_customer_id !== "") {
    customerIDStripe = customerIdResponse?.stripe_customer_id
    console.log('stripe customer already exits')
    if (customerIDStripe === null) {
      const customer = await stripe.customers.create();
      customerIDStripe = customer.id

      const query = {
        text: `UPDATE users
               SET stripe_customer_id = $1
               WHERE id = $2;`,
        values: [customerIDStripe, customerId]
      };

      // Execute query
      await pool.query(query);

    }
  } else {


  }

  console.log("stripe_customer_id:", customerIDStripe)



  if (customerIDStripe !== "") {

    const ephemeralKey = await stripe.ephemeralKeys.create(
      { customer: customerIDStripe },
      { apiVersion: '2024-12-18.acacia' }
    );

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round((amount + charges) * 100),
      currency: 'usd',
      customer: customerIDStripe,
      capture_method: 'manual',
      payment_method_types: ['card', 'cashapp'],

    });

    const paymentIntentId = paymentIntent.id;



    console.log('paymentIntentId', paymentIntentId);
    await pool.query(
      'INSERT INTO transactions (user_id, description, amount, status, transaction_date, transaction_type, transaction_id, intent, intent_type, charges) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,$10)',
      [
        customerIdResponse?.id,
        'Ride Fee Payment',
        charges,
        'Pending',
        new Date().toISOString(),
        'Debit',
        paymentIntentId,
        paymentIntentId,
        'intenal-payment',
        '0%'
      ]
    );

    res.json({
      paymentId: paymentIntent?.id,
      paymentIntent: paymentIntent.client_secret,
      ephemeralKey: ephemeralKey.secret,
      customer: customerIDStripe,
      publishableKey: stripePublishableApiKey
    });

  } else {

    console.log('Invalid stripe customer ID')
    return res.status(400).json({ message: 'Invalid stripe customer ID', status: false });


  }

});


function extractTokenId(token) {
  const match = token.match(/\[(.*?)\]/); // Use a regex to find text inside square brackets
  return match ? match[1] : null; // Return the matched content or null if not found
}



app.post('/update-push-token', async (req, res) => {
  const { id, token_id, type } = req.body;

  console.log('PUSH TOKEN UPDATE', (token_id));

  if (!id || !token_id || !type) {
    return res.status(400).json({ message: 'Invalid request data' });
  }

  // Validate table name to prevent SQL injection
  const table = type === 'driver' ? 'drivers' : 'users';

  // Ensure table name is safe by allowing only predefined options
  if (!['drivers', 'users'].includes(table)) {
    return res.status(400).json({ message: 'Invalid type specified' });
  }

  // Correct PostgreSQL query with $1, $2 placeholders
  const query = `UPDATE ${table} SET token = $1 WHERE id = $2`;

  try {
    const result = await pool.query(query, [(token_id), id]);

    if (result.rowCount > 0) {
      res.status(200).json({ message: 'Token updated successfully' });
    } else {
      res.status(404).json({ message: 'User not found' });
    }
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});



async function pushNotification(title, message, token) {
    const notification = {
        to: token,
        sound: 'default',
        title: title,
        body: message,
    };

    try {
        const response = await axios.post('https://exp.host/--/api/v2/push/send', notification, {
            headers: {
                'Content-Type': 'application/json'
            }
        });

        console.log('EXPO_PUSH_SERVICE',response.data);

       

        return response.data;
    } catch (error) {
        console.error('Error sending push notification:', error.message);

    }
}



const sendMailMessage = async (body, receiver, subject) => {
  console.log('sending mail', body);

  try {
    const apiUrl = 'http://qoaproject.top/yasser/send-email-message.php';

    const params = {
      email: receiver,
      subject: subject,
      content: body,
    };

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
    });

    const data = await response.json();
    console.log(data);
  } catch (error) {
    console.error(error);
  }

};

app.post('/reply-ticket', async (req, res) => {
  const { name, email, message, id } = req.body
  sendMailMessage(message, email, 'Replying to: ' + name)

  const deleteTicket = await pool.query({
    text: 'DELETE FROM reports WHERE id = $1',
    values: [id]
  })

  console.log('deleteTicket rsponse:', deleteTicket ? 'deleted' : 'could not be deleted')

  res.status(200).json({
    status: true
  })

})

async function sendMail(otp, receiver, subject) {
  try {
    const apiUrl = 'http://qoaproject.top/yasser/send-email.php';
    const params = `?email=${receiver}&subject=${subject}&content=${otp}`;

    const response = await fetch(apiUrl + params);
    const data = await response.json();
    console.log(data);
  } catch (error) {
    console.error(error);
  }
}
// Usage: sendMail with an example OTP


app.get('/', async (req, res) => {
  res.send('Yasser APP API');

  await sendMail('we are live!', 'anoibi47@gmail.com', 'API node server up and running')

});


app.post('/admin/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    console.log('login admin request:', req.body)

    // Validate input
    if (!password) {
      return res.status(400).json({ message: 'Password cannot be empty', status: false });
    }
    if (!email) {
      return res.status(400).json({ message: 'Email cannot be empty', status: false });
    }

    // Get administrator data
    const getStatusQuery = {
      text: `SELECT * FROM administration WHERE email = $1`,
      values: [email],
    };

    const result = await pool.query(getStatusQuery);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Administrator login credentials incorrect', status: false });
    }

    const storedHash = result.rows[0].password;
    const isValidPassword = await bcrypt.compare(password, storedHash);

    if (!isValidPassword) {
      return res.status(404).json({ message: 'Administrator login credentials incorrect', status: false });
    }

    res.status(200).json({ message: 'Login was successful. Redirecting to dashboard', status: true, data: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Internal Server Error', status: false });
  }
});

const dispatchStatistics = async () => {
  try {
    const bookings = await pool.query("SELECT hailed, status FROM bookings");

    const totalBookings = bookings.rows.length;

    const waitingBookings = bookings.rows.filter((booking) => booking.hailed === '0').length;
    const onTheWayBookings = bookings.rows.filter((booking) => booking.status === 'accepted').length;
    const arrivingBookings = bookings.rows.filter((booking) => booking.hailed === '1').length;

    const waitingPercentage = (waitingBookings / totalBookings) * 100;
    const onTheWayPercentage = (onTheWayBookings / totalBookings) * 100;
    const arrivingPercentage = (arrivingBookings / totalBookings) * 100;

    return [
      { type: 'waiting', value: `${waitingPercentage.toFixed(2)}%` },
      { type: 'onTheWay', value: `${onTheWayPercentage.toFixed(2)}%` },
      { type: 'arriving', value: `${arrivingPercentage.toFixed(2)}%` },
    ];
  } catch (error) {
    console.error(error);
    throw error;
  }
};


const getRealtimeRides = async () => {
  try {
    const bookings = await pool.query(`
      SELECT 
        EXTRACT(HOUR FROM booktime::timestamp) AS hour,
        COUNT(*) AS total_bookings
      FROM 
        bookings
      WHERE 
        status = 'accepted' 
        AND booktime::timestamp >= NOW() - INTERVAL '1 day'
      GROUP BY 
        EXTRACT(HOUR FROM booktime::timestamp)
      ORDER BY 
        hour
    `);

    const hourlyData = Array(13).fill(0); // 6 AM to 6 PM (13 hours)

    bookings.rows.forEach((booking) => {
      const hour = booking.hour;
      if (hour >= 6 && hour <= 18) {
        hourlyData[hour - 6] = booking.total_bookings;
      }
    });

    return hourlyData;
  } catch (error) {
    console.error(error);
    throw error;
  }
};



app.get('/admin/delete-account', async (req, res) => {
  try {
    const userId = req.query.id; // Assuming you have a middleware to authenticate users
    const user = req.query.type == 'passenger' ?
      await pool.query('SELECT email, name FROM users WHERE id = $1', [userId])
      :
      req.query.type == 'admin' ? await pool.query('SELECT email, name FROM administration WHERE id = $1', [userId])
        :
        await pool.query('SELECT email, name FROM drivers WHERE id = $1', [userId])

    const userEmail = user.rows[0].email;
    const userName = user.rows[0].name;


    const subject = 'Account Deletion Confirmation';
    const body = `
      <html>
        <body>
          <h2>Dear ${userName},</h2>
          <p>This email confirms that your account has been successfully deleted from our platform.</p>
          <p>We regret to see you go, but we respect your decision to leave. If you have any questions or concerns, please don't hesitate to reach out to us.</p>
          <p>Thank you for being a part of our community.</p>
          <p>Best regards,</p>
          <p>YESATT</p>
        </body>
      </html>
    `;

    await sendMailMessage(body, userEmail, subject);

    const result = req.query.type == 'passenger' ?
      await pool.query('DELETE FROM users WHERE id = $1', [userId])
      :
      req.query.type == 'admin' ?
        await pool.query('DELETE FROM administration WHERE id = $1', [userId])
        :
        await pool.query('DELETE FROM drivers WHERE id = $1', [userId]);

    res.json({ message: 'Account deleted successfully', status: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal Server Error', status: false });
  }
});


app.post('/admin/broadcast-message', (req, res) => {
  const message = req.body.message;

  // Fetch all user emails from database
  pool.query('SELECT email FROM users UNION SELECT email FROM drivers', (err, result) => {
    if (err) {
      console.error('error fetching user emails:', err);
      res.status(500).send({ message: 'Error fetching user emails', status: false });
      return;
    }

    // Send email to each user
    result.rows.forEach((row) => {
      sendMailMessage(message, row.email, req.body.subject);
    });

    res.send({ message: 'Message broadcasted successfully', status: true });
  });
});




app.get('/admin/fetch-transaction', async (req, res) => {
  const page = req.query.page || 1;
  const limit = 10;
  const offset = (page - 1) * limit;

  try {
    const result = await pool.query(
      `SELECT * FROM transactions ORDER BY id DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const transactions = result.rows;

    const totalCount = await pool.query('SELECT COUNT(*) FROM transactions');
    const totalPages = Math.ceil(totalCount.rows[0].count / limit);

    res.json({
      transactions,
      pagination: {
        page,
        limit,
        totalPages,
        totalCount: totalCount.rows[0].count,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal Server Error', status: false });
  }
});


app.get('/admin/fetch-riders', async (req, res) => {
  const page = req.query.page || 1;
  const limit = 10;

  const offset = (page - 1) * limit;

  try {
    const result = await pool.query(
      `SELECT * FROM users ORDER BY id DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const users = result.rows;

    const totalCount = await pool.query('SELECT COUNT(*) FROM users');
    const totalPages = Math.ceil(totalCount.rows[0].count / limit);

    console.log('admin/fetch-riders', {
      users,
      pagination: {
        page,
        limit,
        totalPages,
        totalCount: totalCount.rows[0].count,
      },
    })
    res.json({
      users,
      pagination: {
        page,
        limit,
        totalPages,
        totalCount: totalCount.rows[0].count,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});



app.get('/admin/fetch-drivers', async (req, res) => {

  const page = req.query.page || 1;
  const limit = 10;

  const offset = (page - 1) * limit;

  try {
    const result = await pool.query(
      `SELECT * FROM drivers ORDER BY id DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const users = result.rows;

    const totalCount = await pool.query('SELECT COUNT(*) FROM drivers');
    const totalPages = Math.ceil(totalCount.rows[0].count / limit);

    console.log('admin/fetch-drivers', {
      users,
      pagination: {
        page,
        limit,
        totalPages,
        totalCount: totalCount.rows[0].count,
      },
    })

    res.json({
      users,
      pagination: {
        page,
        limit,
        totalPages,
        totalCount: totalCount.rows[0].count,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});



async function getMonthlyPerformance(intentType) {
  const currentMonth = new Date().getMonth();
  const currentYear = new Date().getFullYear();
  const firstDayOfMonth = new Date(currentYear, currentMonth, 1);
  const lastDayOfMonth = new Date(currentYear, currentMonth + 1, 0);

  const currentMonthResult = await pool.query('SELECT SUM(amount::DECIMAL) AS total_amount FROM transactions WHERE intent_type = $1 AND TO_TIMESTAMP(transaction_date, \'YYYY-MM-DDTHH:MI:SS.MS Z\') >= $2 AND TO_TIMESTAMP(transaction_date, \'YYYY-MM-DDTHH:MI:SS.MS Z\') <= $3', [intentType, firstDayOfMonth.toISOString(), lastDayOfMonth.toISOString()]);

  const currentMonthTotalAmount = currentMonthResult.rows[0].total_amount || 0;

  const previousMonthFirstDay = new Date(firstDayOfMonth.getFullYear(), firstDayOfMonth.getMonth() - 1, 1);
  const previousMonthLastDay = new Date(firstDayOfMonth.getTime() - 86400000);

  const previousMonthResult = await pool.query('SELECT SUM(amount::DECIMAL) AS total_amount FROM transactions WHERE intent_type = $1 AND TO_TIMESTAMP(transaction_date, \'YYYY-MM-DDTHH:MI:SS.MS Z\') >= $2 AND TO_TIMESTAMP(transaction_date, \'YYYY-MM-DDTHH:MI:SS.MS Z\') <= $3', [intentType, previousMonthFirstDay.toISOString(), previousMonthLastDay.toISOString()]);

  const previousMonthTotalAmount = previousMonthResult.rows[0].total_amount || 0;

  let percentagePerformance;
  if (previousMonthTotalAmount === 0) {
    percentagePerformance = 0;
  } else {
    percentagePerformance = ((currentMonthTotalAmount / previousMonthTotalAmount) - 1) * 100;
  }

  return {
    total: currentMonthTotalAmount ? parseFloat(currentMonthTotalAmount).toFixed(2) : '0.00',
    percentagePerformance: percentagePerformance.toFixed(2),
    growthIndicator: currentMonthTotalAmount > previousMonthTotalAmount ? 'positive' : 'negative'
  };
}



app.get('/admin/fetch-bookings', async (req, res) => {
  const page = req.query.page || 1;
  const limit = 10;

  const offset = (page - 1) * limit;

  try {
    const result = await pool.query(
      `SELECT * FROM bookings ORDER BY id DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const bookings = result.rows;

    const totalCount = await pool.query('SELECT COUNT(*) FROM bookings');
    const totalPages = Math.ceil(totalCount.rows[0].count / limit);

    console.log('admin/fetch-riders', {
      bookings,
      pagination: {
        page,
        limit,
        totalPages,
        totalCount: totalCount.rows[0].count,
      },
    })
    res.json({
      bookings,
      pagination: {
        page,
        limit,
        totalPages,
        totalCount: totalCount.rows[0].count,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});



app.get('/management-summary', async (req, res) => {
  const { id } = req.query
  try {

    const adminAcccountQuery = {
      text: `SELECT * FROM administration WHERE id = $1`,
      values: [id],
    };

    const adminAcccount = await pool.query(adminAcccountQuery);
    console.log('adminAcccount:', adminAcccount)

    let depositPerformance = {
      percentagePerformance: '0.00',
      total: '0',
      growthIndicator: 'positive'
    }


    const internalDepositPerformance = await getMonthlyPerformance('internal-deposit');
    console.log('Internal Deposit Performance:', internalDepositPerformance);

    const cancelRideFeePaymentPerformance = await getMonthlyPerformance('cancel-ride-fee-payment');
    console.log('Cancel Ride Fee Payment Performance:', cancelRideFeePaymentPerformance);

    const externalPayoutPerformance = await getMonthlyPerformance('external-payout');
    console.log('External Payout Performance:', externalPayoutPerformance);


    const results = await Promise.all([
      pool.query('SELECT COUNT(*) FROM users'),
      pool.query('SELECT COUNT(*) FROM drivers'),
      pool.query('SELECT COUNT(*) FROM bookings'),
      pool.query('SELECT COUNT(*) FROM uploaded_cars'),
      pool.query(`
        SELECT b.*, u.name 
        FROM bookings b 
        JOIN users u ON b.passenger_id::integer = u.id 
        ORDER BY b.id DESC
      `),
      pool.query('SELECT * FROM reports'),
      pool.query({
        text: 'SELECT * FROM bookings WHERE status = $1',
        values: ['accepted']
      }),
      pool.query('SELECT * FROM administration ORDER BY id DESC'),
      pool.query('SELECT * FROM transactions'),
      pool.query('SELECT SUM(account_balance::numeric) AS total_user_balance FROM users'),
      pool.query('SELECT SUM(account_balance::numeric) AS total_driver_balance FROM drivers')


    ]);


    const rideShareInProgressQuery = {
      text: `SELECT * FROM bookings WHERE status = $1`,
      values: ['accepted'],
    };

    const rideShareInProgressResponse = await pool.query(rideShareInProgressQuery);


    const fetchVehicles = await pool.query('SELECT * FROM uploaded_cars ORDER BY id DESC');

    const vehiclesWithDriverDetails = await Promise.all(
      fetchVehicles.rows.map(async (vehicle) => {
        const fetchDriver = await pool.query('SELECT * FROM drivers WHERE id = $1', [vehicle.driver_id]);
        const driver = fetchDriver.rows[0];

        return {
          ...vehicle,
          driver,
        };
      })
    );

    console.log('vehiclesWithDriverDetails', vehiclesWithDriverDetails);

    const usersCount = results[0].rows[0].count;
    const driversCount = results[1].rows[0].count;
    const bookingsCount = results[2].rows[0].count;
    const uploadedCarsCount = results[3].rows[0].count;
    let totalInflow = 0
    let totalOutflow = 0

    const transactionsQuery = {
      text: `SELECT amount, transaction_type FROM transactions`,
    };

    const transactionsResponse = await pool.query(transactionsQuery);



    const fetchKYC = {
      text: `SELECT * FROM kyc`,
    };

    const fetchKycRes = await pool.query(fetchKYC);

    const kyc = fetchKycRes.rows;


    const transactions = transactionsResponse.rows;



    transactions.forEach((transaction) => {
      if (transaction.transaction_type === 'Credit') {
        totalInflow += parseFloat(transaction.amount);
      } else if (transaction.transaction_type === 'Debit') {
        totalOutflow += parseFloat(transaction.amount);
      }
    });


    const hourlyRides = await getRealtimeRides();
    const dispatchStatisticsExec = await dispatchStatistics();

    console.log('dispatchStatisticsExec', dispatchStatisticsExec)

    console.log('hourlyRides', hourlyRides)


    const stripeApiKeys = await getApiKeys()

    console.log('api keys', stripeApiKeys)


    const totalUserBalance = results[9].rows[0].total_user_balance || 0;
    const totalDriverBalance = results[10].rows[0].total_driver_balance || 0;


    res.json({
      totalUserBalance,
      totalDriverBalance,
      users: usersCount,
      drivers: driversCount,
      totalInflow,
      totalOutflow,
      bookings: bookingsCount,
      uploadedCars: uploadedCarsCount,
      rides: results[4].rows,
      hourlyRides,
      kyc,
      vehicles: vehiclesWithDriverDetails,
      depositPerformance: internalDepositPerformance,
      payoutPerformance: externalPayoutPerformance,
      cancelChargePerformance: cancelRideFeePaymentPerformance,
      stripeSecretKey: stripeApiKeys.stripe_secret_key,
      stripePublishableApiKey: stripeApiKeys.stripe_publishable_api_key,
      reports: results[5].rows,
      activeBookings: results[(5 + 1)].rows,
      account: adminAcccount?.rows[0],
      dispatchStat: dispatchStatisticsExec,
      admins: results[(5 + 2)].rows,
      rideShareInProgress: rideShareInProgressResponse?.rows ? rideShareInProgressResponse?.rows?.length : 0,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});



app.post('/admin/update-api', (req, res) => {
  let apiData = req.body;

  // Update the API keys in the database
  pool.query('UPDATE settings SET stripe_secret_key = $1, stripe_publishable_api_key = $2',
    [apiData.stripeSecretKey, apiData.stripePublishableApiKey],
    (err, result) => {
      if (err) {
        console.error('error updating API keys:', err);
        res.status(500).send({ message: 'Error updating API keys', status: false });
        return;
      }

      res.send({ message: 'API keys updated successfully', status: true });
    }
  );
});




app.post('/admin/reject-licence', async (req, res) => {
  let data = req.body;

  // Update the API keys in the database
  console.log('reject licence:', data)
  pool.query('UPDATE drivers SET verified = $1 WHERE id = $2',
    [0, data?.driver_id],
    async (err, result) => {
      if (err) {
        console.error('error updating API keys:', err);
        res.status(500).send({ message: 'Error: ' + err?.message, status: false });
        return;
      }

      sendMailMessage(
        `
              <html>
                <body style="font-family: Arial, sans-serif; margin: 0; padding: 0;">
                  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f2f2f2; padding: 20px;">
                    <tr>
                      <td>
                        <table width="600" border="0" cellspacing="0" cellpadding="0" style="margin: 0 auto; background-color: #ffffff; padding: 20px;">
                          <tr>
                            <td>
                              <h2 style="color: #333333; font-size: 24px; font-weight: bold; margin-bottom: 10px;">Licence Rejected</h2>
                              <p style="color: #666666; font-size: 16px; margin-bottom: 20px;">Dear Yesatt Driver,</p>
                              <p style="color: #666666; font-size: 16px; margin-bottom: 20px;">We regret to inform you that your driver's licence has been rejected.</p>
                              <p style="color: #666666; font-size: 16px; margin-bottom: 20px;">Please ensure that your uploaded licence meets all the necessary requirements and try again.</p>
                              <p style="color: #666666; font-size: 16px; margin-bottom: 20px;">Thank you for using our services. If you have any questions or concerns, please do not hesitate to contact us.</p>
                              <p style="color: #666666; font-size: 16px; margin-bottom: 20px;">Best regards,</p>
                              <p style="color: #666666; font-size: 16px; margin-bottom: 20px;">Yesatt</p>
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                  </table>
                </body>
              </html>
            `,
        data?.email,
        'Driver Licence Rejected'
      )

      await pool.query('DELETE FROM kyc WHERE id = $1', [data?.id])

      res.send({ message: 'Licence rejected', status: true });
    }
  );
});


app.post('/admin/approve-licence', (req, res) => {
  let data = req.body;

  // Update the API keys in the database

  console.log('approve licence:', data)
  pool.query('UPDATE drivers SET verified = $1 WHERE id = $2',
    [1, data?.driver_id],
    async (err, result) => {
      if (err) {
        console.error('error updating API keys:', err);
        res.status(500).send({ message: 'Error: ' + err?.message, status: false });
        return;
      }

      sendMailMessage(
        `
              <html>
                <body style="font-family: Arial, sans-serif; margin: 0; padding: 0;">
                  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f2f2f2; padding: 20px;">
                    <tr>
                      <td>
                        <table width="600" border="0" cellspacing="0" cellpadding="0" style="margin: 0 auto; background-color: #ffffff; padding: 20px;">
                          <tr>
                            <td>
                              <h2 style="color: #333333; font-size: 24px; font-weight: bold; margin-bottom: 10px;">Congratulations!</h2>
                              <p style="color: #666666; font-size: 16px; margin-bottom: 20px;">Dear Yesatt Driver,</p>
                              <p style="color: #666666; font-size: 16px; margin-bottom: 20px;">We are pleased to inform you that your driver's licence has been successfully verified and approved.</p>
                              <p style="color: #666666; font-size: 16px; margin-bottom: 20px;">Your uploaded licence has met all the necessary requirements, and you are now eligible to drive.</p>
                              <p style="color: #666666; font-size: 16px; margin-bottom: 20px;">Thank you for using our services. If you have any questions or concerns, please do not hesitate to contact us.</p>
                              <p style="color: #666666; font-size: 16px; margin-bottom: 20px;">Best regards,</p>
                              <p style="color: #666666; font-size: 16px; margin-bottom: 20px;">Yesatt</p>
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                  </table>
                </body>
              </html>
            `,
        data?.email,
        'Driver Licence Approved'
      )

      await pool.query('DELETE FROM kyc WHERE id = $1', [data?.id])
      res.send({ message: 'Licence approved', status: true });
    }
  );
});


app.post('/admin/add-new-staff', (req, res) => {
  let staffData = req.body;

  // Hash the password
  bcrypt.hash(staffData.password, 10, (err, hashedPassword) => {
    if (err) {
      console.error('error hashing password:', err);
      res.status(500).send({ message: 'Error hashing password', status: false });
      return;
    }

    pool.query('SELECT * FROM administration WHERE email = $1', [staffData.email], (err, result) => {
      if (err) {
        console.error('error checking email:', err);
        res.status(500).send({ message: 'Error checking email', status: false });
        return;
      }

      if (result.rows.length > 0) {
        // User exists
        res.status(400).send({ message: 'User with this email already exists', status: false });
        return;
      }

      // Insert the staff data into the database
      pool.query('INSERT INTO administration (email, password, address, phone, role, name) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
        [staffData.email, hashedPassword, staffData.country, staffData.phone, staffData.role, staffData.firstName + ' ' + staffData.lastName],
        (err, result) => {
          if (err) {
            console.error('error inserting staff data:', err);
            res.status(500).send({ message: 'Error inserting staff data', status: false });
            return;
          }

          var message = `
            <h4>Congratulations!</h4>
            <p>Hello, ${staffData.firstName}</p>
            <p>We are thrilled to inform you that you have been assigned a new job role at YESATT!</p>
            <p>Your new role is: <strong>${staffData?.role.toUpperCase()}</strong></p>
            <p>We believe your skills and experience make you an ideal fit for this position, and we are excited to have you on board! </p>
            <p>To get started, please find your login details below:</p>
            <table border="0" cellpadding="0" cellspacing="0">
              <tr>
                <td><strong>Admin login:</strong></td>
                <td>https://yesatt.com/admin</td>
              </tr>
              <tr>
                <td><strong>Email:</strong></td>
                <td>${staffData?.email}</td>
              </tr>
              <tr>
                <td><strong>Password:</strong></td>
                <td>Please use the temporary password: <strong>${staffData?.password}</strong> (You can change this password in your dashboard)</td>
              </tr>
            </table>
            <p>If you have any questions or concerns, please don't hesitate to reach out to us.</p>
            <p>Welcome to the YESATT team!</p>
            <p>Best regards,</p>
            <p>The YESATT Team</p>
          `;

          sendMailMessage(message, staffData?.email, 'New Job Role Alert')
          res.status(200).send({ message: 'Staff member added successfully', data: result.rows[0], status: true });
        }
      );
    });
  });
});

// Start the server


app.post('/admin/fetch-updates', async (req, res) => {
  try {
    console.log('admin: fetch updates request....')
    // Validate input

    // Get driver status
    const getBookingsLengthQuery = {
      text: `SELECT * FROM bookings`
    };

    const getBookingsLength = await pool.query(getBookingsLengthQuery);

    const getAvailableRidesQuery = {
      text: `SELECT * FROM drivers WHERE active_status = $1`,
      values: [1],
    };

    const getAvailableRides = await pool.query(getAvailableRidesQuery);

    const getAllUsersQuery = {
      text: `SELECT * FROM users`
    };

    const getAllUsers = await pool.query(getAllUsersQuery);


    res.status(200).json({
      message: 'updates fetched',
      status: true,
      bookedRides: getBookingsLength.rows.length,
      totalEarnings: 0,
      cancelledRides: 0,
      availableRides: getAvailableRides.rows.length,
      totalTodayPickup: 0,
      totalPickupPayment: 0,
      totalUsers: getAllUsers.rows.length,
      totalTransactions: 0,
      ongoingRides: 0

    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Internal Server Error', status: false });
  }
});

app.post('/admin/fetch-drivers', async (req, res) => {
  try {
    const { type } = req.body;
    console.log('admin: fetch drivers request:', req.body)
    // Validate input

    // Get driver status
    const getVerifiedQuery = {
      text: `SELECT * FROM drivers WHERE verified = $1 ORDER BY id DESC`,
      values: ['1'],
    };

    const result1 = await pool.query(getVerifiedQuery);


    const getUnVerifiedQuery = {
      text: `SELECT * FROM drivers WHERE verified = $1 ORDER BY id DESC`,
      values: ['0'],
    };

    const result2 = await pool.query(getUnVerifiedQuery);

    const getrankedQuery = {
      text: `SELECT * FROM drivers ORDER BY id DESC`
    };

    const result3 = await pool.query(getrankedQuery);


    res.status(200).json({ message: 'Drivers fetched', status: true, unverified: result1.rows, verified: result2.rows, ranked: result3.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Internal Server Error', status: false });
  }
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

app.post('/account/user/fetch-updates', async (req, res) => {
  try {
    const { id } = req.body;
    console.log('getting new user account updates')
    // Validate input
    if (!id) {
      return res.status(400).json({ message: 'user ID is required', status: false });
    }

    // Get driver status
    const getUserQuery = {
      text: `SELECT * FROM users WHERE id = $1`,
      values: [id],
    };

    const result = await pool.query(getUserQuery);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'User not found', status: false });
    }

    const userInfo = result.rows[0];
    res.status(200).json({ message: 'User data retrieved successfully', status: true, data: userInfo });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Internal Server Error', status: false });
  }
});


app.post('/account/driver/fetch-updates', async (req, res) => {
  try {
    const { id } = req.body;
    console.log('getting new driver account updates')
    // Validate input
    if (!id) {
      return res.status(400).json({ message: 'driver ID is required', status: false });
    }

    // Get driver status
    const getUserQuery = {
      text: `SELECT * FROM drivers WHERE id = $1`,
      values: [id],
    };

    const result = await pool.query(getUserQuery);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Us driver not found', status: false });
    }

    const userInfo = result.rows[0];
    res.status(200).json({ message: 'driver data retrieved successfully', status: true, data: userInfo });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Internal Server Error', status: false });
  }
});




app.get('/stripe-api-key', async (req, res) => {
  try {
    // Return Stripe API key
    const apikey = '';
    const getKey = await getApiKeys()

    res.status(200).json({ apikey: getKey.stripe_publishable_api_key, secretStripeKey: getKey.stripe_secret_key, status: true });
  } catch (error) {
    // Handle internal server error
    res.status(500).json({ message: 'Internal Server Error', status: false });
  }
});


app.post('/driver/update-status', async (req, res) => {
  try {
    const { id, url } = req.body

    const customerId = id

    console.log('update driver status request', req.body)
    // Validate input
    if (!id) {
      res.status(400).json({ message: 'Driver ID is required', status: false, onboard: false });
    }


    await checkFaceVerification(id, 'driver', res)


    if (stripe == null) {
      await initializeStripe()
    }

    let CONNECT = false

    // Use an existing Customer ID if this is a returning customer.

    console.log('connect wallet: ', req.body)

    const query = {
      text: `SELECT * FROM drivers
               WHERE id = $1;`,
      values: [customerId]
    };

    // Execute query
    const fetchCustomerStripeID = await pool.query(query);
    let customerIdResponse = fetchCustomerStripeID.rows[0]
    let customerIDStripe = '';

    console.log(customerIdResponse)
    let customerAccountId = customerIdResponse?.stripe_account_id
    if (customerIdResponse?.stripe_account_id === null) {
      console.log('customer CONNECT ID does not exists')
      const account = await stripe.accounts.create({
        country: 'US',
        email: customerIdResponse.email,
        controller: {
          fees: {
            payer: 'application',
          },
          losses: {
            payments: 'application',
          },
          stripe_dashboard: {
            type: 'none',
          },
          requirement_collection: 'application'
        },
        country: 'US',
        capabilities: {
          transfers: {
            requested: true,
          },
        },
      });


      const query = {
        text: `UPDATE drivers
             SET stripe_account_id = $1
             WHERE id = $2;`,
        values: [account.id, customerId]

      };

      // Execute query
      await pool.query(query);

      console.log(account)

      const accountLink = await stripe.accountLinks.create({
        account: account.id,
        refresh_url: url + '/refresh-account-link?url=' + url + '&user=' + customerId + '&id=' + account.id,
        return_url: url + '/onboard-stripe',
        type: 'account_onboarding',
      });

      console.log(accountLink)
      CONNECT = true
      res.status(200).json({ message: 'Please you need to connect driver app to Stripe to start collecting payout!', onboard: true, accountLink, status: true });


    } else {

      try {

        const account = await stripe.accounts.retrieve(customerAccountId);

        console.log('retrieve account data', account)

        if (account?.charges_enabled) {
          console.log('account already connected')
          // res.status(200).json({ message: 'Account connected! Proceed', onboard: false , id: customerAccountId, status: true});
        } else {
          const accountLink = await stripe.accountLinks.create({
            account: customerAccountId,
            refresh_url: url + '/refresh-account-link?url=' + url + '&user=' + customerId + '&id=' + customerAccountId,
            return_url: url + '/onboard-stripe',
            type: 'account_onboarding',
          });

          console.log(accountLink)

          CONNECT = true
          res.status(200).json({ message: 'Please you need to connect driver app to Stripe to start  collecting payout!', onboard: true, accountLink, status: true });

        }
      } catch (err) {
        const accountLink = await stripe.accountLinks.create({
          account: customerAccountId,
          refresh_url: url + '/refresh-account-link?url=' + url + '&user=' + customerId + '&id=' + customerAccountId,
          return_url: url + '/onboard-stripe',
          type: 'account_onboarding',
        });

        console.log(accountLink)

        CONNECT = true

        res.status(200).json({ message: 'Please you need to connect driver app to Stripe to start  collecting payout!', onboard: true, accountLink, status: true });

      }


    }



    // Get current active_status
    const getCurrentStatusQuery = {
      text: `SELECT active_status FROM drivers WHERE id = $1`,
      values: [id],
    };

    const result = await pool.query(getCurrentStatusQuery);

    if (result.rows.length === 0) {
      res.status(404).json({ message: 'Driver not found', status: false, onboard: false });
    } else {

      const currentStatus = result.rows[0].active_status;
      const newStatus = currentStatus == 1 ? 0 : 1;

      // Update active_status
      const updateQuery = {
        text: `UPDATE drivers SET active_status = $1 WHERE id = $2 RETURNING *`,
        values: [newStatus, id],
      };

      const updatedDriver = await pool.query(updateQuery);

      console.log(`Driver updated: ${updatedDriver.rows[0]}`);
      if (!CONNECT) {
        res.status(200).json({ message: 'Status updated successfully!', status: true, driverstatus: newStatus, onboard: false });

      }
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Internal Server Error', status: false, onboard: false });
  }
});

app.post('/wallet-summary', async (req, res) => {
  const { driverID } = req.body;

  if (!driverID) {
    return res.status(400).json({ message: 'Driver ID is required' });
  }

  try {
    const bookings = await pool.query({
      text: `
        SELECT book_amount, booktime
        FROM bookings
        WHERE driver_id = $1 AND status = 'completed'
      `,
      values: [driverID],
    });

    const currentDate = new Date();
    const currentWeek = getWeekNumber(currentDate);
    const currentMonth = currentDate.getMonth() + 1;
    const currentYear = currentDate.getFullYear();

    let weeklyTotal = 0;
    let monthlyTotal = 0;
    let yearlyTotal = 0;
    let todayTotal = 0;

    bookings.rows.forEach((booking) => {
      const bookingDate = new Date(booking.booktime);
      const bookingWeek = getWeekNumber(bookingDate);
      const bookingMonth = bookingDate.getMonth() + 1;
      const bookingYear = bookingDate.getFullYear();

      if (bookingWeek === currentWeek && bookingYear === currentYear) {
        weeklyTotal += parseFloat(booking.book_amount);
      }

      if (bookingMonth === currentMonth && bookingYear === currentYear) {
        monthlyTotal += parseFloat(booking.book_amount);
      }

      if (bookingYear === currentYear) {
        yearlyTotal += parseFloat(booking.book_amount);
      }

      if (
        bookingDate.getDate() === currentDate.getDate() &&
        bookingDate.getMonth() === currentDate.getMonth() &&
        bookingDate.getFullYear() === currentDate.getFullYear()
      ) {
        todayTotal += parseFloat(booking.book_amount);
      }
    });

    const chartData = [];
    const colors = ['#177AD5', 'gray', '#177AD5', 'gray', '#177AD5', 'gray', '#177AD5'];
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    for (let i = 0; i < 7; i++) {
      const dayTotal = bookings.rows.reduce((acc, booking) => {
        const bookingDate = new Date(booking.booktime);
        if (bookingDate.getDay() === i) {
          return acc + parseFloat(booking.book_amount);
        }
        return acc;
      }, 0);

      chartData.push({
        value: dayTotal,
        label: dayNames[i],
        frontColor: colors[i],
      });
    }

    return res.status(200).json({
      weekly: weeklyTotal,
      monthly: monthlyTotal,
      yearly: yearlyTotal,
      today: todayTotal,
      chart: chartData,
      status: true
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Internal Server Error', status: false });
  }
});

// Helper function to get week number
function getWeekNumber(date) {
  const oneJan = new Date(date.getFullYear(), 0, 1);
  return Math.ceil(
    ((date - oneJan) / 86400000 + oneJan.getDay() + 1) / 7
  );
}

// Helper function to get week number
function getWeekNumber(date) {
  const oneJan = new Date(date.getFullYear(), 0, 1);
  return Math.ceil(
    ((date - oneJan) / 86400000 + oneJan.getDay() + 1) / 7
  );
}

// Helper function to get month name
function getMonthName(monthNumber) {
  const monthNames = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  return monthNames[monthNumber - 1];
}

// Helper function to get week number
function getWeekNumber(date) {
  const oneJan = new Date(date.getFullYear(), 0, 1);
  return Math.ceil(
    ((date - oneJan) / 86400000 + oneJan.getDay() + 1) / 7
  );
}

// Helper function to get week number
function getWeekNumber(date) {
  const oneJan = new Date(date.getFullYear(), 0, 1);
  return Math.ceil((((date - oneJan) / 86400000) + oneJan.getDay() + 1) / 7);
}

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

      await sendMailMessage('OTP CODE: ' + otpCode, email, 'OTP Verification');


      // Insert OTP into otp table
      await pool.query(
        'INSERT INTO verification (email, otp_code) VALUES ($1, $2)',
        [email, otpCode]
      );
    } catch (err) {
      console.error('Error inserting OTP:', err);
      // Handle the error, e.g., rollback the user creation
    }

    const active_status = 0

    const rides_preference = 'auto'

    const newUser = await pool.query(
      'INSERT INTO drivers (name, phone, country, account_balance, email, password, latitude, longitude, verified, active_status, rating, customers, years_of_experience, rides_preference) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 0, 0, 0, $11) RETURNING *',
      [name, phone, country, account_balance, email, hashedPassword, latitude, longitude, verified, active_status, rides_preference]
    );




    console.log(`User inserted: ${newUser.rows[0]}`);
    res.status(200).json({ message: 'Account created successfully!', userId: newUser.rows[0].id, status: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Internal Server Error', status: false });
  }
});

function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}


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


app.get('/totp/:key', async (req, res)=>{
  const secret = req.params
 
 var token = speakeasy.totp({
  secret: secret.key,
  encoding: 'base32'
});

if(token){
res.status(200).json({message: 'Token generated successfully', token: token, status: true})
}else{
  res.status(500).json({message: 'Error generating token', status: false})
}

 

})


app.post('/update-photo', async (req, res) => {
  try {
    const { id, type, uri } = req.body;

    if (type == 'driver') {
      await pool.query('UPDATE drivers SET photo = $1, face_verified = $2  WHERE id = $3', [uri, 0, id]);

    } else {
      await pool.query('UPDATE users SET photo = $1, face_verified = $2  WHERE id = $3', [uri, 0, id]);

    }

    res.json({ message: 'User photo updated successfully!', status: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal Server Error', status: false });
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


app.post('/driver/update-geolocation', async (req, res) => {
  try {

    console.log('request body', req.body)
    const { id, latitude, longitude } = req.body;
    await pool.query(
      'UPDATE drivers SET latitude = $1, longitude = $2  WHERE id = $3',
      [latitude, longitude, id]
    );
    res.status(200).json({ message: 'Geolocation updated!', status: true });
  } catch (error) {
    //console.error(error);
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


app.post('/driver/:id/update-bio', async (req, res) => {
  try {

    console.log('request body', req.body)
    const { id, name, email, phone, countryName, about } = req.body;
    await pool.query(
      'UPDATE drivers SET name = $1, email = $2, phone = $3, country = $4, about = $5  WHERE id = $6',
      [name, email, phone, countryName, about, id]
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
      await sendMailMessage('OTP CODE: ' + otpCode, email, 'OTP Verification');

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


app.post('/add-payment-card', async (req, res) => {
  try {
    const { cardNumber, cardExpMonth, cardExpYear, cardCvc, userId, cardName } = req.body;

    console.log('request body:', req.body);

    if (stripe == null) {
      await initializeStripe()
    }

    const token = await stripe.tokens.create({
      card: {
        number: cardNumber,
        exp_month: cardExpMonth,
        exp_year: cardExpYear,
        cvc: cardCvc,
      },
    });

    // Fetch user balance
    let result = await pool.query(
      'SELECT stripe_account_id FROM drivers WHERE id = $1',
      [userId]
    );

    // Check if user exists
    customerIDStripe = result.rows[0]?.stripe_account_id


    const externalAccount = await stripe.accounts.createExternalAccount(
      customerIDStripe,
      {
        external_account: 'tok_visa_debit',
      }
    );

  } catch (err) {
    console.log(err);
    res.status(500).json({ message: 'Internal Server Error', status: false });
  }
});


app.post('/delete-payment-method', async (req, res) => {
  try {
    const { id, type, stripeAccountId } = req.body;

    if (stripe == null) {
      await initializeStripe()
    }

    switch (type) {
      case 'card':
        const deleteCardQuery = {
          text: `DELETE FROM payment_cards WHERE id = $1`,
          values: [id],
        };
        await pool.query(deleteCardQuery);
        break;
      case 'bank':
        const deleted = await stripe.accounts.deleteExternalAccount(
          stripeAccountId,
          id
        );
        if (!deleted.deleted) {
          res.status(400).json({ message: 'Failed to delete bank account', status: false });
          return;
        }
        break;
      default:
        res.status(400).json({ message: 'Invalid payment method type', status: false });
        return;
    }

    res.status(200).json({ message: 'Payment method deleted successfully', status: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Internal Server Error', status: false });
  }
});

app.post('/fetch-payment-methods', async (req, res) => {
  try {
    const userId = req.body.id;
    const stripeAccountId = req.body.stripeAccountId;

    if (stripe == null) {
      await initializeStripe()
    }

    const paymentCardsQuery = {
      text: `SELECT *, 'card' AS type FROM payment_cards WHERE user_id = $1 ORDER BY id DESC`,
      values: [userId],
    };

    const paymentCardsResponse = await pool.query(paymentCardsQuery);

    const externalAccounts = await stripe.accounts.listExternalAccounts(
      stripeAccountId,
      {
        object: 'bank_account',
      }
    );

    const maskCardNumber = (cardNumber) => {
      return `****${cardNumber.slice(-4)}`;
    };

    const paymentMethods = {
      paymentCards: paymentCardsResponse.rows.map((card) => ({
        ...card,
        card_number: maskCardNumber(card.card_number),
      })),
      connectedBankAccounts: externalAccounts.data.map((account) => ({
        id: account.id,
        account_holder_name: account.account_holder_name,
        bank_name: account.bank_name,
        last4: account.last4,
        type: 'bank',
      })),
      status: true,
    };

    res.status(200).json(paymentMethods);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Internal Server Error', status: false });
  }
});

app.post('/add-bank-account', async (req, res) => {
  try {

    const { userId, country, currency, accountHolderName, accountHolderType, routingNumber, accountNumber } = req.body;

    source_type = 'bank_account'

    if (stripe == null) {
      await initializeStripe()
    }

    // Fetch user balance
    let result = await pool.query(
      'SELECT stripe_account_id FROM drivers WHERE id = $1',
      [userId]
    );

    // Check if user exists
    customerIDStripe = result.rows[0]?.stripe_account_id

    const token = await stripe.tokens.create({
      bank_account: {
        country: country,
        currency: currency,
        account_holder_name: account_holder_name,
        account_holder_type: account_holder_type,
        routing_number: routing_number,
        account_number: account_number,
      },
    });

    const updatePayoutAccount = await stripe.accounts.createExternalAccount(
      customerIDStripe,
      {
        external_account: token?.id,
      }
    );

    res.status(201).json({ message: 'Bank account added successfully', status: true });
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: 'Internal Server Error', status: false });
  }
});

app.post('/create-card-token', async (req, res) => {
  try {

    const { cardNumber, cardExpMonth, cardExpYear, cardCvc } = req.body
    const token = await stripe.tokens.create({
      card: {
        number: cardNumber,
        exp_month: cardExpMonth,
        exp_year: cardExpYear,
        cvc: cardCvc,
      },
    });

  } catch (err) {
    res.status(500).json({ message: 'Internal Server Error', status: false });

  }
})


app.post('/transactions', async (req, res) => {
  try {
    const { id, type } = req.body;

    // Check if user exists
    let typeOfTransaction = ''
    switch (type) {
      case 'in':
        typeOfTransaction = 'Credit'
        break

      case 'out':
        typeOfTransaction = 'Debit'
        break
    }
    const history = await pool.query(
      'SELECT * FROM transactions WHERE user_id = $1 AND transaction_type = $2 ORDER BY id DESC',
      [id, typeOfTransaction]
    );

    if (history.rows.length > 0) {
      // Format transaction date
      history.rows.forEach((transaction) => {
        const date = new Date(transaction.transaction_date);
        const day = date.getDate();
        const month = date.toLocaleString('default', { month: 'long' });
        const year = date.getFullYear();
        const hours = date.getHours();
        const minutes = date.getMinutes();
        const ampm = hours >= 12 ? 'pm' : 'am';

        transaction.transaction_date = `${day} ${month} ${year}, ${hours % 12 || 12}:${minutes.toString().padStart(2, '0')}${ampm}`;
      });

      return res.status(200).json({ data: history.rows, status: true });
    } else {
      return res.status(210).json({ message: 'No transactions yet', status: false });
    }
  } catch (err) {
    return res.status(501).json({ status: false, message: 'Internal server error' });
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
    res.status(500).json({ message: 'Internal Server Error', status: false });
  }
});



// Function to calculate distance between two coordinates (Haversine Formula)
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Radius of Earth in km
  const toRad = (angle) => (Math.PI / 180) * angle;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
    Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) *
    Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Distance in km
}

app.post('/fetch-drivers', async (req, res) => {
  try {
    const {
      pickupLatitude,
      pickupLongitude,
      destinationLatitude,
      destinationLongitude,
      radius = 10,
    } = req.body;

    console.log('Request body:', req.body);

    if (!pickupLatitude || !pickupLongitude || !destinationLatitude || !destinationLongitude) {
      return res.status(400).json({
        message: 'Pickup and destination coordinates are required',
        status: false,
        drivers: [],
      });
    }
    const activeDriversQuery = `
    SELECT * FROM drivers 
    WHERE active_status = '1'
  `;


    const { rows: drivers } = await pool.query(activeDriversQuery);

    if (drivers.length === 0) {
      return res.status(404).json({
        message: 'No active drivers found within the specified radius',
        status: false,
        drivers: [],
      });
    }

    // Calculate distances in JavaScript (faster and avoids SQL issues)
    const processedDrivers = drivers
      .map((driver) => ({
        ...driver,
        distance: calculateDistance(
          pickupLatitude,
          pickupLongitude,
          parseFloat(driver.latitude),
          parseFloat(driver.longitude)
        ),
      }))
      .filter((driver) => driver.distance <= radius) // Filter out drivers beyond radius
      .sort((a, b) => a.distance - b.distance); // Sort by distance

    // Limit to max 20, but shuffle if more than 10
    let finalDrivers = processedDrivers.slice(0, 20);
   
    console.log('finalDrivers',finalDrivers.length)
    // Fetch cars and reviews for each driver
    const driversWithDetails = await Promise.all(
      finalDrivers.map(async (driver) => {
        const { rows: cars } = await pool.query(
          'SELECT * FROM uploaded_cars WHERE driver_id = $1',
          [driver.id]
        );

        console.log('fetched driver car',cars.length)

        const { rows: reviews } = await pool.query(
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

        const destinationDistance = calculateDistance(
          parseFloat(driver.latitude),
          parseFloat(driver.longitude),
          parseFloat(destinationLatitude),
          parseFloat(destinationLongitude)
        );

        console.log('destinationDistance',destinationDistance)

        const totalDistance = driver.distance + destinationDistance;
        const speed = 40 / 60; // km per minute
        const baseFare = 0.12;
        const perKilometerFare = 1.03;
        let fareMultiplier = 1;
        const totalFare = (baseFare + totalDistance * perKilometerFare * fareMultiplier).toFixed(2);

        const etaInMinutes = Math.floor(totalDistance / speed);
        const eta =
          etaInMinutes < 60
            ? `${etaInMinutes} mins`
            : `${Math.floor(etaInMinutes / 60)}h ${etaInMinutes % 60}mins`;

        let cent = '';
        let actualVal = '';
        if (totalFare.includes('.')) {
          [actualVal, cent] = totalFare.split('.');
        } else {
          actualVal = totalFare;
          cent = '00';
        }

        // Fetch ride options
        const updatedCars = await Promise.all(
          cars.map(async (car) => {
            const { rows: rideOptions } = await pool.query(
              'SELECT * FROM ride_options WHERE ride_id = $1',
              [car.id]
            );

            return rideOptions.map((rideOption) => {
              const updatedCar = { ...car, id: rideOption.id, pickuptype: rideOption.ride_option };

              if (rideOption.ride_option === 'priority') {
                updatedCar.eta = Math.max(etaInMinutes - 1, 0);
                updatedCar.fare = (parseFloat(totalFare) - 0.5).toFixed(2);
              } else {
                updatedCar.eta = etaInMinutes;
                updatedCar.fare = totalFare;
              }

              return updatedCar;
            });
          })
        );

        const flatUpdatedCars = updatedCars.flat().sort((a, b) => {
          if (a.pickuptype === 'priority' && b.pickuptype !== 'priority') return -1;
          if (a.pickuptype !== 'priority' && b.pickuptype === 'priority') return 1;
          return a.distance - b.distance;
        });


        console.log({
          ...driver,
          cars: flatUpdatedCars,
          rideOptionsLength: flatUpdatedCars.length,
          eta,
          fare: `${parseFloat(actualVal).toFixed(2)}`,
          fareCent: cent,
          reviews,
        })

        return {
          ...driver,
          cars: flatUpdatedCars,
          rideOptionsLength: flatUpdatedCars.length,
          eta,
          fare: `${parseFloat(actualVal).toFixed(2)}`,
          fareCent: cent,
          reviews,
        };
      })
    );

    res.status(200).json({ drivers: driversWithDetails, status: true });
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


app.post('/report', async (req, res) => {

  const { name, email, message, image } = req.body
  if (!name || !email || !message) {
    return res.status(400).json({ message: 'Required fields are missing', status: false });
  }
  const result = await pool.query(
    `INSERT INTO reports (name, email, message,photo)
   VALUES ($1, $2, $3, $4) RETURNING *`,
    [name, email, message, image]
  );
  if (result) {

    return res.status(200).json({ message: 'Issue has been submitted. Our team will respond to this issue.', status: true });

  } else {
    return res.status(410).json({ message: 'Internal server error', status: false });

  }

});



app.post('/add-stops', async (req, res) => {
  try {
    const { booking_code, coords, user_id, place } = req.body;

    console.log('add stops request data:', req.body);

    // Get driver email from bookings table
    const driverEmailQuery = `SELECT driver_id FROM bookings WHERE booking_code = $1`;
    const driverEmailResult = await pool.query(driverEmailQuery, [booking_code]);
    const driverId = driverEmailResult.rows[0].driver_id;

    const driverEmailQuery2 = `SELECT email FROM drivers WHERE id = $1`;
    const driverEmailResult2 = await pool.query(driverEmailQuery2, [driverId]);
    const driverEmail = driverEmailResult2.rows[0].email;

    // Insert into ride stops table
    const insertRideStopsQuery = `INSERT INTO ride_stops (place, latitude, longitude, user_id, code) VALUES ($1, $2, $3, $4, $5)`;
    await pool.query(insertRideStopsQuery, [place, coords.lat, coords.lng, user_id, booking_code]);

    // Send email to driver
    sendMailMessage(`New ride stop added, for current onging pickup`, driverEmail, `Ride Stop Update`);

    res.json({ message: 'Ride stop added successfully', status: true });
  } catch (err) {
    console.error(err);
    res.status(400).json({ message: 'Internal server error', status: false });
  }
});


app.post('/edit-destination', async (req, res) => {
  try {
    const { booking_code, coords, user_id, place } = req.body;

    console.log('edit destination request data:', req.body);

    // Update destination in database
    const updateDestinationQuery = `UPDATE bookings SET destination_latitude = $1, destination_longitude = $2, destination_place = $3 WHERE booking_code = $4`;
    await pool.query(updateDestinationQuery, [coords.lat, coords.lng, place, booking_code]);


    // Get driver email from bookings table
    const driverEmailQuery = `SELECT driver_id FROM bookings WHERE booking_code = $1`;
    const driverEmailResult = await pool.query(driverEmailQuery, [booking_code]);
    const driverId = driverEmailResult.rows[0].driver_id;

    const driverEmailQuery2 = `SELECT email FROM drivers WHERE id = $1`;
    const driverEmailResult2 = await pool.query(driverEmailQuery2, [driverId]);
    const driverEmail = driverEmailResult2.rows[0].email;

    // Send email to driver
    sendMailMessage(`Destination updated for booking #${booking_code}. The destination for your current ride has been updated`, driverEmail, `Current Ride Destination Changed`);

    res.json({ message: 'Destination updated successfully', status: true });
  } catch (err) {
    console.error(err);
    res.status(400).json({ message: 'Internal server error', status: false });
  }
});


app.post('/rebook-ride', async (req, res) => {
  try {
    const { bookingCode } = req.body;

    // Check if booking code is provided
    if (!bookingCode) {
      return res.status(400).json({ message: 'Booking code is required', status: false });
    }

    // Get the booking data using the booking code
    const getBookingQuery = {
      text: `SELECT * FROM bookings
             WHERE booking_code = $1`,
      values: [bookingCode],
    };

    const bookingRes = await pool.query(getBookingQuery);

    // Check if booking exists
    if (bookingRes.rows.length === 0) {
      return res.status(404).json({ message: 'Booking not found', status: false });
    }

    const bookingData = bookingRes.rows[0];

    // Get the driver data
    const getDriverQuery = {
      text: `SELECT * FROM drivers
             WHERE id = $1`,
      values: [bookingData.driver_id],
    };

    const driverRes = await pool.query(getDriverQuery);

    // Check if driver is available
    if (driverRes.rows[0].active_status === '0') {
      return res.status(400).json({ message: 'Oops! The driver is not available at the moment', status: false });
    }

    // Update the booking status and booktime
    const currentTime = new Date();
    const formattedDateTime = currentTime.toLocaleString('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });

    const updateBookingQuery = {
      text: `UPDATE bookings
             SET status = $1, booktime = $2
             WHERE booking_code = $3`,
      values: ['pending', formattedDateTime, bookingCode],
    };

    await pool.query(updateBookingQuery);

    // Send email notification to driver
    const driverEmail = driverRes.rows[0].email;
    const driverToken = driverRes.rows[0].token;

    sendMailMessage(`You have a rebooked ride request at Pickup location: ${bookingData.place} - Destination: ${bookingData.destination_place} . Passenger is expecting you. Accept or Reject ride`, driverEmail, 'Rebooked Ride Request');
    await pushNotification('Ride Alert',`You have a rebooked ride request at Pickup location: ${bookingData.place} - Destination: ${bookingData.destination_place} . Passenger is expecting you. Accept or Reject ride`, driverToken );
    res.status(200).json({
      message: `You have rebooked a past ride request at Pickup location: ${bookingData.place} - Destination: ${bookingData.destination_place} . Driver will be notified`,
      status: true,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal Server Error', status: false });
  }
});

app.post('/book-ride', async (req, res) => {
  try {
    const { driver_id, passenger_id, from_latitude, from_longitude, destination_latitude,
      destination_longitude, book_amount, place, car_id, destination_place,
      stop_latitude, stop_longitude, stop_place, pickuptype, payment, intent } = req.body;

    // Input validation







    if (!passenger_id || !from_latitude || !from_longitude || !destination_latitude || !destination_longitude || !book_amount) {
      return res.status(400).json({ message: 'Required fields are missing', status: false });
    }

await checkFaceVerification(passenger_id, 'rider', res)

    console.log('book request:', req.body)

    let fetchDriverDetail = await pool.query(
      'SELECT requested FROM drivers WHERE id = $1',
      [driver_id]
    );

    const driverResponse = fetchDriverDetail?.rows[0]

    if (Number(driverResponse?.requested) == 1) {
      // return res.status(400).json({ message: 'We regret to inform you that the driver assigned to your current booking is currently unavailable. Please wait for the driver to become available or consider booking an alternative ride. We apologize for any inconvenience this may cause and appreciate your patience.', status: false });

    }



    // Fetch user balance
    if (payment == 'wallet') {
      let fetchBalance = await pool.query(
        'SELECT account_balance FROM users WHERE id = $1',
        [passenger_id]
      );

      const res = fetchBalance.rows[0]

      if (book_amount > parseFloat(res?.account_balance)) {
        return res.status(400).json({ message: 'Your wallet balance is insufficient! Try using cash as payment method', status: false });

      }
    }


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

    if (stop_latitude && stop_longitude) {
      console.log('values not null')
      const insertRideStopsQuery = `INSERT INTO ride_stops (place, latitude, longitude, user_id, code, intent) VALUES ($1, $2, $3, $4, $5, $6)`;
      await pool.query(insertRideStopsQuery, [stop_place, stop_latitude, stop_longitude, passenger_id, bookingCode, intent]);


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


    const hailed = 0

    const is_overlay = true
    // Insert booking into database
    const result = await pool.query(
      `INSERT INTO bookings (passenger_id, from_latitude, from_longitude, destination_latitude, destination_longitude, book_amount, status, booking_code, driver_id, place, car_id, destination_place, booktime, stop_latitude, stop_longitude, pickuptype, hailed, is_overlay, payment)
   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19) RETURNING *`,
      [passenger_id, from_latitude, from_longitude, destination_latitude, destination_longitude, book_amount, 'pending', bookingCode, driver_id, place, car_id, destination_place, formattedDateTime, stop_latitude, stop_longitude, pickuptype, hailed, is_overlay, payment]
    );
    const getDriverQuery = {
      text: `SELECT * FROM drivers
         WHERE id = $1`,
      values: [driver_id],
    };

    const driverRes = await pool.query(getDriverQuery);

    await pool.query(
      'UPDATE drivers SET requested = $1 WHERE id = $2',
      ['1', driver_id]
    );


    console.log('driver data:', driverRes)
    sendMailMessage(`You have a ride request at Pickup location: ${place} - Destination: ${destination_place} . Passenger is expecting you. Accept or Reject ride`, driverRes.rows[0].email, 'New RIde Request(View notification)')

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

    const hailed = 1;

    const updateBookingStat = {
      text: `UPDATE bookings SET hailed = $1
             WHERE booking_code = $2`,
      values: [hailed, booking_code],
    };

    await pool.query(updateBookingStat);

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

    await sendMailMessage(mailOptions.text, userEmail, mailOptions.subject)
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
      id = req.body.metadata.id
      res.status(200).send('Webhook received successfully!');
    } else {
      console.log('Invalid payload:', req.body);
      res.status(401).send('Invalid signature!');
    }

    console.log('driver kyc verification data:', req.params)

    // Validate input data
    if (!id) {
      return res.status(400).json({ message: 'Driver ID is required', status: false });
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
      return res.status(404).json({ message: 'Driver not found', status: false });
    }

    res.json({
      message: 'KYC verified successfully!',
      data: result.rows[0],
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal Server Error', status: false });
  }
});



app.post('/driver/fetch-balance', async (req, res) => {
  try {
    const { id } = req.body;

    console.log('fetch balance for id:', id)

    if (stripe == null) {
      await initializeStripe()
    }

    // Fetch user balance
    let result = await pool.query(
      'SELECT stripe_account_id FROM drivers WHERE id = $1',
      [id]
    );

    // Check if user exists
    customerIDStripe = result.rows[0]?.stripe_account_id

    console.log('customerIDStripe: ', customerIDStripe)

    const balance = await stripe.balance.retrieve(
      {
        expand: ['instant_available.net_available'],
      },
      {
        stripeAccount: customerIDStripe,
      }
    );
    console.log(balance)

    const availableStripeBalance = balance.available[0]?.amount

    console.log('availableStripeBalance: ', availableStripeBalance)


    // payDriver(100, customerIDStripe)

    res.status(200).json({
      message: 'User balance fetched successfully',
      balance: availableStripeBalance ? availableStripeBalance : 0,
      withdrawalBalance: balance.instant_available[0]?.amount ? balance.instant_available[0]?.amount : 0,
      status: true,
    });


  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Internal Server Error', status: true, balance: 0, withdrawalBalance: 0 });
  }
});


app.post('/fetch-balance', async (req, res) => {
  try {
    const { id } = req.body;

    console.log('fetch balance for id:', id)


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



app.post('/get-booking', async (req, res) => {
  try {
    const { id } = req.body;

    console.log('Fetch booking data request:', req.body);

    // Fetch booking status from database
    const result = await pool.query(
      `SELECT * FROM bookings 
       WHERE booking_code = $1`,
      [id]

    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Booking not found', ok: false });
    }

    const bookingsData = result.rows;
    const bookingsArray = [];

    for (const booking of bookingsData) {
      const cars = await pool.query(
        'SELECT * FROM uploaded_cars WHERE driver_id = $1',
        [booking.driver_id]
      );

      const fetchDrivers = await pool.query('SELECT * FROM drivers WHERE id = $1', [booking.driver_id]);
      const fetchPassenger = await pool.query('SELECT * FROM users WHERE id = $1', [booking.passenger_id]);



      const carDetails = cars.rows.length > 0
        ? {
          carName: cars.rows[0].car_model,
          pickupType: cars.rows[0].pickupType,
          seat: cars.rows[0].seats,
        }
        : {
          carName: 'None',
          seat: 'None',
          pickupType: 'None'
        };

      // Fetch ride stops for the booking
      const rideStopsQuery = `SELECT * FROM ride_stops WHERE code = $1`;
      const rideStopsResult = await pool.query(rideStopsQuery, [booking.booking_code]);
      const rideStops = rideStopsResult.rows;

      bookingsArray.push({
        info: booking,
        car: cars.rows[0],
        driver: fetchDrivers.rows[0],
        passenger: fetchPassenger.rows[0],
        cancelCharge: 2,
        rideStops: rideStops
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

app.post('/bookings', async (req, res) => {
  try {
    const { status, userId } = req.body;

    console.log('Fetch bookings request:', req.body);

    // Fetch booking status from database
    const result = await pool.query(
      `SELECT * FROM bookings 
       WHERE (passenger_id = $1 OR driver_id = $1) 
       AND status = $2 ORDER BY id DESC`,
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
      const fetchPassenger = await pool.query('SELECT * FROM users WHERE id = $1', [booking.passenger_id]);



      const carDetails = cars.rows.length > 0
        ? {
          carName: cars.rows[0].car_model,
          pickupType: cars.rows[0].pickupType,
          seat: cars.rows[0].seats,
        }
        : {
          carName: 'None',
          seat: 'None',
          pickupType: 'None'
        };

      // Fetch ride stops for the booking
      const rideStopsQuery = `SELECT * FROM ride_stops WHERE code = $1`;
      const rideStopsResult = await pool.query(rideStopsQuery, [booking.booking_code]);
      const rideStops = rideStopsResult.rows;

      bookingsArray.push({
        info: booking,
        car: cars.rows[0],
        driver: fetchDrivers.rows[0],
        passenger: fetchPassenger.rows[0],
        cancelCharge: 2,
        rideStops: rideStops
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

app.post('/admin/delete-vehicle', async (req, res) => {
  const { id } = req.body;

  if (!id) {
    return res.status(400).json({ message: 'Vehicle ID is required', status: false });
  }

  try {
    const deleteVehicleQuery = {
      text: `DELETE FROM uploaded_cars WHERE id = $1 RETURNING *`,
      values: [id],
    };

    const result = await pool.query(deleteVehicleQuery);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Vehicle not found', status: false });
    }

    res.status(200).json({ message: 'Vehicle deleted successfully', data: result.rows[0], status: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal Server Error', status: false });
  }
});


app.post('/update-vehicle', async (req, res) => {
  const { car_vin, car_name, car_color, seats, car_id } = req.body;

  if (!car_vin || !car_name || !car_color || !seats) {
    return res.status(400).json({ message: 'All fields are required', status: false });
  }

  try {
    const updateVehicleQuery = {
      text: `UPDATE uploaded_cars
             SET car_name = $1, car_color = $2, seats = $3, car_number = $4 WHERE id = $5 RETURNING *`,
      values: [car_name, car_color, seats, car_vin, car_id],
    };

    const result = await pool.query(updateVehicleQuery);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Vehicle not found', status: false });
    }

    res.status(200).json({ message: 'Vehicle updated successfully', data: result.rows[0], status: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal Server Error', status: false });
  }
});

app.post('/vehicles/delete-vehicle', async (req, res) => {
  console.log('delete vehicle body data', req.body)
  try {
    const { id, driver_id } = req.body;

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
      res.json({ message: 'No vehicles found for this driver', status: true, data: [] });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Failed to retrieve vehicles', status: true });
  }
});

const apiEndpointVIN = 'https://auto.dev/api/vin/';
const apiKey = 'ZrQEPSkKYW5vaWJpZGlja3NvbkBnbWFpbC5jb20='; // Replace with your actual API key


const apiToken = 'cd72fb9af6643bc4a325edb614d6a11a';
const apiEndpoint = 'https://ping.arya.ai/api/v1/verifyFace';

function generateRequestId() {
  return crypto.randomUUID();
}


app.post('/face-verification', async (req, res) => {
  const { image_base64, url, user_id, type } = req.body;

  if (!image_base64 || !url) {
    res.send({ message: 'Image base64 and URL are required', status: false });
  }

  console.log('req.body', req.body)

  const base64 = await imageUrlToBase64(url);

  const requestId = generateRequestId();
  console.log(requestId);

  try {
    const response = await axios({
      method: 'post',
      url: apiEndpoint, // Replace with your API URL
      headers: {
        token: apiToken,
        'content-type': 'application/json',
      },
      data: {
        doc1_type: 'image',
        doc2_type: 'image',
        img1_base64: image_base64,
        img2_base64: base64,
        req_id: requestId,
      },
    });

    console.log(response.data)

    if (response.data.match) {
      switch (type) {
        case 'driver':
          await pool.query('UPDATE drivers SET face_verified = $1 WHERE id = $2', [1, user_id])
          break

        case 'passenger':
          await pool.query('UPDATE users SET face_verified = $1 WHERE id = $2', [1, user_id])
          break
      }
      res.send({ data: response.data, status: true });

    } else {
      res.send({ message: 'Photo verification failed. Check photo to make sure it matches our profile picture', status: false });

    }
  } catch (error) {
    console.error(error)
    res.status(500).send({ message: 'Internal Server Error', status: false });
  }
});

app.post('/vehicle/register', async (req, res) => {
  console.log('register vehicle body data', req.body)

  try {
    const {
      driver_id,
      car_color,
      seats,
      car_number,
      phone,
      pickuptype,
      latitude,
      longitude,
      organization
    } = req.body;

    // Validate input data
    if (!driver_id || !car_color || !seats || !car_number || !phone) {
      return res.status(400).json({ message: 'Missing required fields', status: false });
    }


    await checkFaceVerification(driver_id, 'driver', res)

    const url = `${apiEndpointVIN}${car_number}?apikey=${apiKey}`;

    const verificationResponse = await fetch(url);
    const dataVin = await verificationResponse.json();

    console.log('dataVin:', dataVin)

    if (dataVin?.status == 'NOT_FOUND') {
      return res.status(500).json({ message: dataVin?.message, status: false });

    }

    if (dataVin?.status == 'BAD_REQUEST') {
      return res.status(500).json({ message: dataVin?.message, status: false });

    }

    let car_model = ''
    let car_name = ''

    if (dataVin?.make) {
      car_model = dataVin?.model?.name
      car_name = dataVin?.make?.name
    }

    if (car_name == '' || car_model == '') {
      res.status(404).json({
        status: false,
        message: 'VIN could not be verfied!'
      })
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
        longitude,
        status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
      values: [
        driver_id,
        car_model,
        car_color,
        car_name,
        'none',
        seats,
        car_number,
        phone,
        '',
        latitude,
        longitude,
        false
      ],
    };

    const result = await pool.query(query);

    if (result) {
      const queries = pickuptype.map((option) => {
        const insertOptions = {
          text: `INSERT INTO ride_options (
        ride_id,
        ride_option
      ) VALUES ($1, $2) RETURNING *`,
          values: [result.rows[0].id, option],
        };
        return pool.query(insertOptions);
      });

      await Promise.all(queries);

      console.log('ride options added');
    }


    // Update organisation column in drivers table
    const updateQuery = {
      text: `UPDATE drivers
             SET organisation = $1
             WHERE id = $2`,
      values: [organization, driver_id],
    };

    await pool.query(updateQuery);

    const getVehiclesQuery = {
      text: `SELECT * FROM uploaded_cars WHERE driver_id = $1  ORDER BY id DESC`,
      values: [driver_id],

    };

    const vehiclesRes = await pool.query(getVehiclesQuery);

    // Return success response
    res.json({ message: car_name.toUpperCase() + ' with VIN: ' + car_number + ', has been registered', data: vehiclesRes.rows, status: true });
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

    console.log('driver fetched coords', driverLocation)

    res.status(200).json({
      message: 'Driver current location fetched',
      status: true,
      coords: driverLocation.rows[0],
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

app.post('/driver/location', async (req, res) => {
  try {
    const { id } = req.body;

    console.log('Fetch all driver location request:', req.body);

    if (!userId) {
      return res.status(400).json({ message: 'Driver ID is required', status: false });
    }

    const result = await pool.query(
      `SELECT latitude, longitude FROM drivers WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(200).json({
        message: 'Driver not found in our records',
        status: false,
        count: 0
      });
    }

    const coordinates = result.rows;
    console.log('driver coords fetched: ' + coordinates)

    res.status(200).json({
      message: 'Driver location fetched',
      status: true,
      data: coordinates
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


    const fetBookings = await pool.query(
      `SELECT * FROM bookings WHERE id = $1`,
      [id]
    );

    if (fetBookings.rows.length > 0) {
      const driverID = fetBookings.rows[0]?.driver_id
      await pool.query(
        'UPDATE drivers SET requested = $1 WHERE id = $2',
        ['0', driverID]
      );
    }


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



app.post('/overlay-ride', async (req, res) => {
  try {
    const { id } = req.body;

    // Input validation
    if (!id) {
      return res.status(400).json({ message: 'Ride ID is required', status: false });
    }

    // Update ride status to rejected
    const overlay = false
    const result = await pool.query(
      `UPDATE bookings SET is_overlay = $1 WHERE booking_code = $2 RETURNING *`,
      [overlay, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Ride not found', status: false });
    }

    res.status(200).json({
      message: 'Ride overlay removed successfully',
      ride: result.rows[0],
      status: true
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal Server Error', status: false });
  }
});


async function checkFaceVerification(id, type, res) {
  try {
    let query;
    if (type === 'driver') {
      query = {
        text: 'SELECT face_verified FROM drivers WHERE id = $1',
        values: [id],
      };
    } else if (type === 'rider') {
      query = {
        text: 'SELECT face_verified FROM users WHERE id = $1',
        values: [id],
      };
    } else {
      return res.status(400).json({ message: 'Invalid type. Type must be either "driver" or "rider".', status: false });
    }

    const result = await pool.query(query);

    if (Number(result.rows[0].face_verified) == 0) {
      return res.status(404).json({ message: `Photo Verification Needed`, status: false });
    }else{
      console.log('photo verified')
    }

  } catch (error) {
  }
}


app.post('/rider/cancel-ride', async (req, res) => {
  try {
    const { id, charge } = req.body;

    const existingBooking = await pool.query(
      `SELECT * FROM bookings WHERE booking_code = $1`,
      [id]
    );
    if (existingBooking.rows.length > 0) {

      const getDriverQuery = {
        text: `SELECT * FROM drivers
                 WHERE id = $1`,
        values: [existingBooking.rows[0].driver_id],
      };

      const driverRes = await pool.query(getDriverQuery);

      const getRiderQuery = {
        text: `SELECT * FROM users
                 WHERE id = $1`,
        values: [existingBooking.rows[0].passenger_id],
      };

      const RiderRes = await pool.query(getRiderQuery);

      const driveToken = driverRes.rows[0].token


      console.log('cancel ride request:', req.body)
      const newBalance = Number(RiderRes.rows[0].account_balance) - Number(charge);
      await pool.query(
        'UPDATE users SET account_balance =  $1 WHERE id = $2',
        [newBalance, existingBooking.rows[0].passenger_id]
      );

      let transactionId;
      let isUnique = false;

      while (!isUnique) {
        transactionId = uuidv4();
        const existingTransaction = await pool.query(
          'SELECT * FROM transactions WHERE transaction_id = $1',
          [transactionId]
        );

        if (existingTransaction.rows.length === 0) {
          isUnique = true;
        }
      }

      // Insert transaction
      await pool.query(
        'INSERT INTO transactions (user_id, description, amount, status, transaction_date, transaction_type, transaction_id, intent, intent_type, charges) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,$10)',
        [
          existingBooking.rows[0].passenger_id,
          'Cancel Ride Fee',
          charge,
          'Successful',
          new Date().toISOString(),
          'Debit',
          transactionId,
          'cancel-ride-fee-payment',
          transactionId,
          '$0'
        ]
      );

      sendMailMessage(`Ride request at Pickup location: ${existingBooking.rows[0].place}, was cancelled by passenger.`, driverRes.rows[0].email, 'Ride Request Cancelled')
      await pushNotification('Ride cancelled',`Ride request at Pickup location: ${existingBooking.rows[0].place}, was cancelled by passenger.`,driveToken)


    }

    // Update booking status in database
    const result = await pool.query(
      `DELETE FROM bookings WHERE booking_code = $1`,
      [id]
    );

    res.status(200).json({
      message: 'Booked ride has been cancelled. Driver will be notified and charge fee will be applied!',
      booking: result.rows[0],
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

    const existingBooking = await pool.query(
      `SELECT * FROM bookings WHERE booking_code = $1`,
      [id]
    );
    if (existingBooking.rows.length > 0) {
      const passengerQuery = {
        text: `SELECT * FROM users
               WHERE id = $1`,
        values: [existingBooking.rows[0].passenger_id],
      };

      const passengerRes = await pool.query(passengerQuery);


      const passengerToken = passengerRes?.rows[0]?.token

      sendMailMessage(`Ride request at Pickup location: ${existingBooking.rows[0].place}, was cancelled by driver.`, driverRes.rows[0].email, 'Ride Request Cancelled')
      await pushNotification('Ride cancelled',`Ride request at Pickup location: ${existingBooking.rows[0].place}, was cancelled by driver.`,passengerToken)

    }

    // Update booking status in database
    const result = await pool.query(
      `DELETE FROM bookings WHERE booking_code = $1`,
      [id]
    );

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
    const { id } = req.body;

    console.log('Accept ride request:', req.body)

    // Update booking status in database
    const result = await pool.query(
      `UPDATE bookings SET status = 'accepted' WHERE booking_code = $1 RETURNING*`,
      [id]
    );


    const fetBookings = await pool.query(
      `SELECT * FROM bookings WHERE booking_code = $1`,
      [id]
    );

    if (fetBookings.rows.length > 0) {
      const driverID = fetBookings.rows[0]?.driver_id
      const passenger_id = fetBookings.rows[0]?.passenger_id
      await pool.query(
        'UPDATE drivers SET requested = $1 WHERE id = $2',
        ['0', driverID]
      );


      const passengerQuery = {
        text: `SELECT * FROM users
               WHERE id = $1`,
        values: [passenger_id],
      };

      const passengerRes = await pool.query(passengerQuery);


      const passengerToken = passengerRes?.rows[0]?.token

      await pushNotification('Driver arriving',`Driver has accepted to come pick you up at your pickup location ${fetBookings.rows[0].place}, please standby and wait!`,passengerToken)



    }





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

app.post('/complete-ride', async (req, res) => {
  try {
    const { id } = req.body;

    console.log('/complete ride:', req.body)
    // Input validation
    if (!id) {
      return res.status(400).json({ message: 'Ride ID is required', status: false });
    }

    // Fetch driver and passenger names
    const bookingInfo = await pool.query('SELECT * FROM bookings WHERE booking_code = $1', [id]);
    const driver = await pool.query('SELECT * FROM drivers WHERE id = $1', [bookingInfo?.rows[0]?.driver_id]);
    const passenger = await pool.query('SELECT * FROM users WHERE id = $1', [bookingInfo?.rows[0]?.passenger_id]);

    if (passenger && driver) {
      await payDriver(bookingInfo?.rows[0]?.book_amount, driver?.rows[0]?.stripe_account_id, bookingInfo?.rows[0]?.passenger_id, bookingInfo?.rows[0]?.intent, bookingInfo?.rows[0]?.payment)

    }


    // Update ride status to completed
    const result = await pool.query(
      `UPDATE bookings SET status = 'completed' WHERE booking_code = $1 RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Ride not found', status: false });
    }


    const passengerToken = passenger.rows[0].token

    await pushNotification('Ride completed',`Hey! ${passenger.rows[0].name} you have arrived your destination at ${fetBookings.rows[0].destination}. Thank you for choosing Yesatt!`,passengerToken)


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


    const driverObject = await pool.query('SELECT * FROM drivers WHERE id = $1', [driver_id]);
    const passengerObject = await pool.query('SELECT * FROM users WHERE id = $1', [passenger_id]);

    const driverToken = driverObject.rows[0].token
    const passengerToken = passengerObject.rows[0].token

    await pushNotification('New message',`Hey! You have a new message, goto messages to reply.`, driver? passengerToken :  driverToken)

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
          LEAST(driver_id, passenger_id), 
          GREATEST(driver_id, passenger_id)
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
        if (Math.floor(timeDiff / 3600) > 24) {
          timeAgo = chat.time_sent
        } else {
          timeAgo = `${Math.floor(timeDiff / 3600)}hr ago`;

        }
      }

      // Fetch driver and passenger names
      const driver = await pool.query('SELECT * FROM drivers WHERE id = $1 OR id = $2', [chat.driver_id, chat.passenger_id]);
      const passenger = await pool.query('SELECT * FROM users WHERE id = $1 OR id = $2', [chat.driver_id, chat.passenger_id]);
      console.log('chat.driver_id: ', chat.driver_id)
      console.log('chat.passenger_id: ', chat.passenger_id)
      return {
        ...chat,
        time_sent: timeAgo,
        driver: driver.rows[0],
        passenger: passenger.rows[0],
      };
    }));

    console.log('recentChats: ', recentChats)

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
    const ins = await pool.query(
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


app.post('/admin/update-bio', async (req, res) => {
  const name = req.body.name;
  const email = req.body.email;
  const phone = req.body.phone;

  // Update bio
  pool.query('UPDATE administration SET name = $1, email = $2::character varying(255), phone = $3 WHERE email = $2::character varying(255)',
    [name, email, phone],
    (err, result) => {
      if (err) {
        console.error('error updating bio:', err);
        res.status(500).send({ message: 'Error updating bio', status: false });
        return;
      }

      res.send({ message: 'Bio updated successfully', status: true });
    }
  );
});

app.post('/admin/reset-password', (req, res) => {
  const email = req.body.email;
  const otp = req.body.otp;
  const password = req.body.password;

  // Verify OTP
  pool.query('SELECT * FROM verification WHERE email = $1 AND otp_code = $2',
    [email, otp],
    (err, result) => {
      if (err) {
        console.error('error verifying OTP:', err);
        res.status(500).send({ message: 'Error verifying OTP', status: false });
        return;
      }

      if (result.rows.length === 0) {
        res.status(400).send({ message: 'Invalid OTP', status: false });
        return;
      }

      // Update password
      const hashedPassword = bcrypt.hashSync(password, 10);
      pool.query('UPDATE administration SET password = $1 WHERE email = $2',
        [hashedPassword, email],
        (err, result) => {
          if (err) {
            console.error('error updating password:', err);
            res.status(500).send({ message: 'Error updating password', status: false });
            return;
          }

          // Delete verification record
          pool.query('DELETE FROM verification WHERE email = $1 AND otp_code = $2',
            [email, otp],
            (err, result) => {
              if (err) {
                console.error('error deleting verification record:', err);
              }
            }
          );

          // Send password reset alert email
          sendMailMessage(`Your password has been reset successfully. If you did not initiate this request, please contact support immediately.`, email, 'Password Reset Alert');

          res.send({ message: 'Password reset successfully', status: true });
        }
      );
    }
  );
});

app.post('/send-otp', (req, res) => {
  const email = req.body.email;

  // Generate OTP
  const otp = Math.floor(100000 + Math.random() * 900000);

  // Save OTP to verification table
  pool.query('INSERT INTO verification (email, otp_code) VALUES ($1, $2) RETURNING *',
    [email, otp.toString()],
    (err, result) => {
      if (err) {
        console.error('error sending OTP:', err);
        res.status(500).send({ message: 'Error sending OTP', status: false });
        return;
      }

      // Send OTP to user's email
      sendMailMessage(`Your OTP is: ${otp}`, email, 'OTP Verification');

      res.send({ message: 'OTP sent successfully', status: true });
    }
  );
});





app.put('/reject-booking/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query('UPDATE bookings SET accepted = rejected WHERE id = ?', id);

    const fetBookings = await pool.query(
      `SELECT * FROM bookings WHERE id = $1`,
      [id]
    );

    if (fetBookings.rows.length > 0) {
      const driverID = fetBookings.rows[0]?.driver_id
      await pool.query(
        'UPDATE drivers SET requested = $1 WHERE id = $2',
        ['0', driverID]
      );
    }


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



app.post('/update-ride-preference', async (req, res) => {


  console.log(' RIDE PREFERENVCE REQUEST BODY', req.body);

  const { type, id } = req.body;



  try {
    await pool.query('UPDATE drivers SET rides_preference = $1 WHERE id = $2', [type, id]);
    res.status(200).json({ message: 'Queued rides preference updated!', status: true });

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


app.post('/submit-kyc', async (req, res) => {
  const { id, email, name, files } = req.body;

  const data = {
    email,
    name,
    files,
    id
  }

  console.log('submitting KYC request:', data)

  // Save the uploaded car to the database
  try {
    await pool.query(
      'INSERT INTO kyc (name, driver_id, email, files) VALUES ($1, $2, $3, $4)',
      [name, id, email, files]
    );

    await pool.query('UPDATE drivers SET verified = $1 WHERE id = $2 ', [2, id])

    sendMailMessage('We have received your documents. Our team will review it within few working days', email, 'Pending: KYC Verification Notice')
    res.json({ message: 'Document uploaded successfully! Do not re-submit data.', status: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal Server Error', status: false });
  }
});



app.post('/transactions', async (req, res) => {
  const { id } = req.body;

  console.log('transactions request body:', req.body)

  // Validate input data
  if (!id) {
    return res.status(400).json({ message: 'User ID is required', status: false });
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
      data: result.rows,
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

async function payDriver(amount, customerIDStripe, passengerID, intent, payment_type) {

  console.log('pay driver with customerIDStripe: ', customerIDStripe)
  console.log('pay driver with amount: ', amount)
  console.log('pay driver with passengerID: ', passengerID)

  if (stripe == null) {
    await initializeStripe()
  }


  if (payment_type != "stripe" && payment_type != "") {

    const paymentIntent = await stripe.paymentIntents.capture(
      intent,
      {
        amount_to_capture: amount,
      }
    );
  }

  const transfer = await stripe.transfers.create({
    amount: amount,
    currency: 'usd',
    destination: customerIDStripe,
  });


  let transactionId;
  let isUnique = false;

  while (!isUnique) {
    transactionId = uuidv4();
    const existingTransaction = await pool.query(
      'SELECT * FROM transactions WHERE transaction_id = $1',
      [transactionId]
    );

    if (existingTransaction.rows.length === 0) {
      isUnique = true;
    }
  }


  const getUserData = await pool.query('SELECT * FROM users WHERE id = $1', [passengerID]);

  // Send deposit notification email
  // Update account balance
  if (payment_type != "stripe") {
    const newBalance = Number(getUserData.rows[0].account_balance) - Number(amount);
    await pool.query(
      'UPDATE users SET account_balance =  $1 WHERE id = $2',
      [newBalance, passengerID]
    );

  }
  // Insert transaction
  await pool.query(
    'INSERT INTO transactions (user_id, description, amount, status, transaction_date, transaction_type, transaction_id, intent, intent_type, charges) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,$10)',
    [
      passengerID,
      'Ride Fare Payment(Stripe)',
      amount,
      'Successful',
      new Date().toISOString(),
      'Debit',
      transactionId,
      'intenal-payment',
      transfer?.id,
      '$0'
    ]
  );


  console.log('transfer: ', transfer)

  // Fetch user balance
  let result = await pool.query(
    'SELECT * FROM drivers WHERE stripe_account_id = $1',
    [customerIDStripe]
  );
  // Check if user exists
  const userId = result.rows[0]?.id
  const getUserPreviousBalance = result.rows[0]
  const email = result.rows[0].email

  console.log('customerIDStripe: ', customerIDStripe)

  // Generate a unique transaction ID
  transactionId;
  isUnique = false;

  while (!isUnique) {
    transactionId = uuidv4();
    const existingTransaction = await pool.query(
      'SELECT * FROM transactions WHERE transaction_id = $1',
      [transactionId]
    );

    if (existingTransaction.rows.length === 0) {
      isUnique = true;
    }
  }

  // Get user's previous balance
  // Send deposit notification email
  sendMailMessage('Transaction Notification, ' + getUserPreviousBalance.name + ', you have received a payment of $' + amount + ', for your just concluded ride pickup!', email, 'Ride Fare Paid')


  // Insert transaction
  await pool.query(
    'INSERT INTO transactions (user_id, description, amount, status, transaction_date, transaction_type, transaction_id, intent,intent_type, charges) VALUES ($1, $2, $3, $4, $5, $6, $7, $8,$9, $10)',
    [
      userId,
      transfer?.type == 'bank_account' ? 'Ride payment pending(Stripe)' : 'Ride payment(Stripe)',
      amount,
      'Successful',
      new Date().toISOString(),
      'Credit',
      transactionId,
      transfer?.id,
      'internal-payout',
      '$0'
    ]
  );

}

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