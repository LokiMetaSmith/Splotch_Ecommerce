const appId = "sandbox-sq0idb-tawTw_Vl7VGYI6CZfKEshA";
const locationId = "LAXYBVS9QJVSC";

let payments, card;

async function BootStrap() {
    try {
        payments = window.Square.payments(appId, locationId);
      } catch (error) {
        const statusContainer = document.getElementById("payment-status-container");
        statusContainer.className = "error text-red";
        statusContainer.style.visibility = "visible";
        statusContainer.textContent = "Failed to load Square SDK " + error.message;
        return
      }
      try {
        card = await initializeCard(payments);
      } catch (e) {
        console.error("Initializing Card failed", e);
      }

}
BootStrap()

async function initializeCard(payments) {
  const card = await payments.card();
  await card.attach("#card-container");

  return card;
}

async function createPayment(token, verificationToken) {
  const body = JSON.stringify({
    locationId,
    sourceId: token,
    verificationToken,
    idempotencyKey: window.crypto.randomUUID(),
  });

  const paymentResponse = await fetch("/payment", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body,
  });

  if (paymentResponse.ok) {
    return paymentResponse.json();
  }

  const errorBody = await paymentResponse.text();
  throw new Error(errorBody);
}

async function tokenize(paymentMethod) {
  const tokenResult = await paymentMethod.tokenize();
  if (tokenResult.status === "OK") {
    return tokenResult.token;
  } else {
    let errorMessage = `Tokenization failed with status: ${tokenResult.status}`;
    if (tokenResult.errors) {
      errorMessage += ` and errors: ${JSON.stringify(tokenResult.errors)}`;
    }

    throw new Error(errorMessage);
  }
}

// Required in SCA Mandated Regions: Learn more at https://developer.squareup.com/docs/sca-overview
async function verifyBuyer(payments, token) {
  const verificationDetails = {
    amount: "1.00",
    billingContact: {
      givenName: "John",
      familyName: "Doe",
      email: "john.doe@square.example",
      phone: "3214563987",
      addressLines: ["123 Main Street", "Apartment 1"],
      city: "London",
      state: "LND",
      countryCode: "GB",
    },
    currencyCode: "GBP",
    intent: "CHARGE",
  };

  const verificationResults = await payments.verifyBuyer(
    token,
    verificationDetails
  );
  return verificationResults.token;
}


// Get the form element
var form = document.getElementById('payment-form');

// Attach the submit event handler
form.addEventListener('submit', function(event) {
  // Prevent the form from submitting normally
  event.preventDefault();

  // Handle the form submission
  console.log('Form submitted', event);
  const formData = new FormData(form);

  // get file from formdata name file
  const file = formData.get('file');
});
