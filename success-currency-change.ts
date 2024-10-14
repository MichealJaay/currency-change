module.exports = ({
  customerName,
  amount,
  currency,
  amountInNaira,
  trxnRef,
}: {
  customerName: string;
  currency: string;
  amount: string;
  amountInNaira: number;
  trxnRef: string;
}) => `<mjml>
<mj-body background-color="#F7F7F7">
  <mj-section>
    <mj-column>
      <mj-image height="50px" width="50px" src="https://err-static.s3.eu-west-2.amazonaws.com/144+x+144.png"></mj-image>
    </mj-column>
  </mj-section>
  <mj-section>
    <mj-column background-color="#fff" padding-top="20px" padding-bottom="20px" border="1px solid #F7F7F7">
      <mj-text font-size="18px" align="center">Your money's arrived</mj-text>
    </mj-column>
  </mj-section>
  <mj-section background-color="#fff">
    <mj-column>
      <mj-text padding-bottom="18px">Hi ${customerName}</mj-text>
      <mj-text padding-bottom="20px" line-height="18px">
        The money you changed has been deposited to your wallet
      </mj-text>

      <mj-text padding-bottom="1px" line-height="18px" font-weight="bold">
        Transfer details:
      </mj-text>
      <mj-text padding-bottom="2px" line-height="18px">
        Your payment number: ${trxnRef} <br>
        You sent: ${currency} ${amount}<br>
        You received: NGN ${amountInNaira}
        </br>
        </br>
      </mj-text>
			 <mj-text padding-bottom="1px" line-height="18px" font-weight="bold">
        Follow your money
      </mj-text>
    	<mj-text padding-bottom="20px" line-height="18px">
        Want to know where your money is every step of the way? Easy! simply og to our app <a href="">ios</a> or <a href="">Android</a> and tap on your transfers in 'Transfers' to track your journey.
      </mj-text>
      <mj-text padding-bottom="1px" line-height="18px" font-weight="bold">
        Got a question?
      </mj-text>
      <mj-text line-height="18px">Please send an email to support@errandlr.com if you have any questions.</mj-text>

        <mj-text line-height="18px">Thank you!</mj-text>
        <mj-text>Errandlr.</mj-text>
    </mj-column>
  </mj-section>
  
  <mj-section>
    <mj-column>
      <mj-text align="center" color="#bababa">Madame Cellular Street, Lekki, Lagos, Nigeria</mj-text>
      <mj-text align="center" color="#bababa">
        <a href="https://errandlr.com/policy/privacy-policy">Privacy Policy</a>
          &nbsp;
        <a href="https://errandlr.com/policy/terms-and-condtions">Terms and Conditions</a>
        &nbsp;
        <a href="https://errandlr.com/policy/faqs">FAQs</a>
      </mj-text>
      <mj-text padding-bottom="20px" line-height="18px" mj-class="typo-subhead-footer" color="#B3B4B6" align="center">
        © Errandlr ${new Date().getFullYear()}
      </mj-text>
    </mj-column>
  </mj-section>
</mj-body>
</mjml>`;
