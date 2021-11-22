"use strict";

const fs = require("fs");
const path = require("path");
const mime = require("mime-types");
const {
  categories,
  homepage,
  posts,
  authors,
  global,
} = require("../../data/data.json");

async function isFirstRun() {
  const pluginStore = strapi.store({
    environment: strapi.config.environment,
    type: "type",
    name: "setup",
  });
  const initHasRun = await pluginStore.get({ key: "initHasRun" });
  await pluginStore.set({ key: "initHasRun", value: true });
  return !initHasRun;
}

async function setPublicPermissions(newPermissions) {
  // Find the ID of the public role
  const publicRole = await strapi
    .query("role", "users-permissions")
    .findOne({ type: "public" });

  // List all available permissions
  const publicPermissions = await strapi
    .query("permission", "users-permissions")
    .find({
      type: ["users-permissions", "application"],
      role: publicRole.id,
    });

  // Update permission to match new config
  const controllersToUpdate = Object.keys(newPermissions);
  const updatePromises = publicPermissions
    .filter((permission) => {
      // Only update permissions included in newConfig
      if (!controllersToUpdate.includes(permission.controller)) {
        return false;
      }
      if (!newPermissions[permission.controller].includes(permission.action)) {
        return false;
      }
      return true;
    })
    .map((permission) => {
      // Enable the selected permissions
      return strapi
        .query("permission", "users-permissions")
        .update({ id: permission.id }, { enabled: true });
    });
  await Promise.all(updatePromises);
}

function getFileSizeInBytes(filePath) {
  const stats = fs.statSync(filePath);
  const fileSizeInBytes = stats["size"];
  return fileSizeInBytes;
}

function getFileData(fileName) {
  const filePath = `./data/uploads/${fileName}`;

  // Parse the file metadata
  const size = getFileSizeInBytes(filePath);
  const ext = fileName.split(".").pop();
  const mimeType = mime.lookup(ext);

  return {
    path: filePath,
    name: fileName,
    size,
    type: mimeType,
  };
}

// Create an entry and attach files if there are any
async function createEntry({ model, entry, files }) {
  try {
    const createdEntry = await strapi.query(model).create(entry);
    if (files) {
      await strapi.entityService.uploadFiles(createdEntry, files, {
        model,
      });
    }
  } catch (e) {
    console.log("model", entry, e);
  }
}

async function importCategories() {
  return Promise.all(
    categories.map((category) => {
      return createEntry({ model: "category", entry: category });
    })
  );
}

async function importHomepage() {
  const files = {
    "seo.shareImage": getFileData("default-image.png"),
  };
  await createEntry({ model: "homepage", entry: homepage, files });
}

async function importAuthors() {
  return Promise.all(
    authors.map(async (author) => {
      const files = {
        picture: getFileData(`${author.email}.jpg`),
      };
      return createEntry({
        model: "author",
        entry: author,
        files,
      });
    })
  );
}

// Randomly set relations on Post to avoid error with MongoDB
function getEntryWithRelations(post, categories, authors) {
  const isMongoose = strapi.config.connections.default.connector == "mongoose";

  if (isMongoose) {
    const randomRelation = (relation) =>
      relation[Math.floor(Math.random() * relation.length)].id;
    delete post.category.id;
    delete post.author.id;

    return {
      ...post,
      category: {
        _id: randomRelation(categories),
      },
      author: {
        _id: randomRelation(authors),
      },
    };
  }

  return post;
}

async function importPosts() {
  const categories = await strapi.query("category").find();
  const authors = await strapi.query("writer").find();

  return Promise.all(
    posts.map((post) => {
      // Get relations for each post
      const entry = getEntryWithRelations(post, categories, authors);

      const files = {
        image: getFileData(`${post.slug}.jpg`),
      };

      return createEntry({
        model: "post",
        entry,
        files,
      });
    })
  );
}

async function importGlobal() {
  const files = {
    favicon: getFileData("favicon.png"),
    "defaultSeo.shareImage": getFileData("default-image.png"),
  };
  return createEntry({ model: "global", entry: global, files });
}

async function importSeedData() {
  // Allow read of application content types
  await setPublicPermissions({
    global: ["find"],
    homepage: ["find"],
    post: ["find", "findone"],
    category: ["find", "findone"],
    author: ["find", "findone"],
  });

  // Create all entries
  await importCategories();
  await importHomepage();
  await importAuthors();
  await importPosts();
  await importGlobal();
}

module.exports = async () => {
  const shouldImportSeedData = await isFirstRun();

  if (shouldImportSeedData) {
    try {
      console.log("Setting up the template...");
      await importSeedData();
      console.log("Ready to go");
    } catch (error) {
      console.log("Could not import seed data");
      console.error(error);
    }
  }
};
