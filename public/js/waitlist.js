document
  .querySelector(".waitlistform")
  .addEventListener("submit", function (event) {
    event.preventDefault(); // Prevent default form submission

    // Get form data
    const formData = new FormData(this);

    // Convert form data to JSON object
    const userData = {};
    formData.forEach((value, key) => {
      userData[key] = value;
    });

    // Send POST request to the server using Axios
    axios
      .post("/add-waitlist-member", userData)
      .then((response) => {
        console.log(response.data);
        // Handle successful response
        // window.alert("Thanks for joining our waitlist. You'll be notified once we're live.")
        window.location.href = "/waitlistsuccess";
      })
      .catch((error) => {
        // Handle error
        console.error("Error:", error.response.data.message);
      });
  });
