import { useState } from "react";

export function SandboxPage() {
  const [question, setQuestion] = useState("");
  const [reply, setReply] = useState("");

  return (
    <section>
      <h2>试问沙箱</h2>
      <p className="lead">用来试探当前契约能否支撑一个问句。M0 不查询数据。</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const text = question.trim();
          setReply(
            text.length === 0
              ? "请先写一个问题。"
              : `已收下问题「${text}」。试问沙箱尚未连接语义内核，M0 不执行查询。`,
          );
        }}
      >
        <label htmlFor="question">问题</label>
        <textarea
          id="question"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="例如：张三还剩多少天年假？"
          rows={4}
        />
        <button type="submit">提问</button>
      </form>
      {reply ? <p className="reply">{reply}</p> : null}
    </section>
  );
}
