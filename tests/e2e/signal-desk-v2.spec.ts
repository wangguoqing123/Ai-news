import { expect,test } from "@playwright/test";

test("V2 five-part information architecture is usable in explicit demo isolation",async({page})=>{
  await page.goto("/today");
  await expect(page.getByText("演示模式 · 不含真实数据")).toBeVisible();
  await expect(page.getByRole("heading",{name:"今天，先看真正重要的变化"})).toBeVisible();
  await expect(page.getByText("47 条新增")).toHaveCount(0);
  await expect(page.getByText("92 分")).toHaveCount(0);
  for(const label of ["今日","AI 动态","博主动态","学习与选题","来源"])await expect(page.getByRole("link",{name:label,exact:true})).toBeVisible();
  await page.goto("/ai-news");await expect(page.getByRole("heading",{name:"AI 世界今天发生了什么"})).toBeVisible();
  await page.goto("/creators");await expect(page.getByRole("heading",{name:"我关注的博主发了什么"})).toBeVisible();
  await page.goto("/learning");await expect(page.getByRole("heading",{name:"把值得看的内容，变成自己的判断"})).toBeVisible();
  await page.goto("/sources");await expect(page.getByRole("heading",{name:"来源",exact:true})).toBeVisible();
});

test("empty demo workspace never invents live records",async({page})=>{
  await page.goto("/today");
  await expect(page.getByText("今天的简报还没有生成")).toBeVisible();
  await expect(page.getByText("这一天还没有可展示的 AI 事件")).toBeVisible();
  await expect(page.getByText("这一天还没有同步到博主新内容")).toBeVisible();
  const health=await page.request.get("/api/health");expect(health.ok()).toBeTruthy();expect((await health.json()).mode).toBe("demo");
});
