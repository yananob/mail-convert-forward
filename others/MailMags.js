let MailMags = {
  APP_NAME: "MailMags",
  FORWARD_TO: "yananob1.mailmag2rss@blogger.com",
  
  forward: function (targetDayOfWeeks, labelName) {
    // check if launch day
    let dt = new Date();
    let dayOfWeek = dt.getDay();
    Logger.log("today: " + dayOfWeek);
    if (targetDayOfWeeks.indexOf(dayOfWeek) == -1) {
      return;
    }
    
    let today = new Date();
    today.setTime(today.getTime() - (24 * 60 * 60 * 1000));
    let target_date = `${today.getFullYear()}/${(today.getMonth() + 1)}/${today.getDate()}`;
    let kw = `label: mailmag-${labelName} is:unread after:${target_date}`;
    Logger.log("kw: " + kw);
    let thds = GmailApp.search(kw, 0, 5);
    for (let n in thds) {
      let thd = thds[n];
      let msgs = thd.getMessages();
      for (m in msgs) {
        let msg = msgs[m];
        
        Logger.log("Forwaring mail: " + msg.getSubject());
        msg.forward(this.FORWARD_TO);
        msg.markRead();
        return;
      }
    }
  }
}

function MailMags_main() {
  Logger.clear();
  Logger.log(`--- ${MailMags.APP_NAME} start.`);
  
  // NikkeiBP
  MailMags.forward([1], "NikkeiBP");  // Forward on Monday
  // Diamond Online
  MailMags.forward([5], "DOL");  // Forward on Friday
  // // IT Media ビジネスオンライン
  // MailMags.forward([3], "ITMedia");  // Forward on Wednesday
  // CodeZine
  MailMags.forward([4], "CodeZine");  // Forward on Thursday （水曜配信だが、午後）
  // Markezine
  MailMags.forward([4], "Markezine");  // Forward on Thursday

  Logger.log(`--- ${MailMags.APP_NAME} end.`);
  
//  sendLog_(MailMags.APP_NAME);
}
