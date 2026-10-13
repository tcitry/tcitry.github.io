import {paginationOptsValidator, paginationResultValidator} from "convex/server";
import {v} from "convex/values";
import {query} from "./_generated/server";
import {accountPagination, requireCommentModerator} from "./commentShared";

const adminArticleLike = v.object({pathname: v.string(), title: v.string(), createdAt: v.number()});

export const listAdmin = query({
  args: {paginationOpts: paginationOptsValidator},
  returns: paginationResultValidator(adminArticleLike),
  handler: async (ctx, args) => {
    await requireCommentModerator(ctx);
    accountPagination(args.paginationOpts);
    const result = await ctx.db.query("articleLikes").withIndex("by_createdAt").order("desc").paginate(args.paginationOpts);
    return {...result, page: result.page.map(row => ({
      pathname: row.pathname, title: row.title?.trim() || row.pathname,
      createdAt: row.createdAt ?? row._creationTime,
    }))};
  },
});
